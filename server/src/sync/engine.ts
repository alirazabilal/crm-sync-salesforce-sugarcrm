// Bi-directional sync engine.
//
// For each entity (accounts first, so opportunities can reference them):
//   1. Pull records changed since the last checkpoint from both CRMs (plus failed records to retry).
//   2. Drop "changes" whose content hash matches what we last synced. This removes our own
//      writes coming back (echoes) and no-op saves, which is what stops infinite ping-pong.
//   3. Pair records: by the id mapping in Mongo, or by natural key (name / email) on first sync.
//   4. If a record changed on both sides, the most recent edit wins and a conflict is logged.
//   5. Write to the other CRM, re-read it, and store both content hashes in the mapping.

import type { ObjectId } from 'mongodb';
import { col, type EntityStats, type Mapping, type SyncRun, type EventAction } from '../db.ts';
import { SYNC_ORDER, getEntityMap, type EntityMap, type EntityName } from '../mapping/fieldMaps.ts';
import { hashFields, normalize, translate, MissingReferenceError, type Side, type RefResolver } from '../mapping/transform.ts';
import type { CrmConnector, CrmRecord } from '../connectors/types.ts';
import type { SalesforceConnector } from '../connectors/salesforce.ts';
import type { SugarConnector } from '../connectors/sugar.ts';

/** Re-read records changed slightly before the checkpoint, to cover clock differences between servers. */
const OVERLAP_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 5;
/** Records written in parallel per entity. Kept low to stay well inside API rate limits. */
const CONCURRENCY = 5;

async function forEachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

interface WorkItem {
  sugar?: CrmRecord;
  sf?: CrmRecord;
  mapping?: Mapping;
  /** id of an existing record on the other side found by natural key */
  partnerSugarId?: string;
  partnerSfId?: string;
  pairedBy?: 'mapping' | 'naturalKey';
}

export interface Connectors {
  sugar: SugarConnector;
  sf: SalesforceConnector;
}

let running = false;
export const isSyncRunning = () => running;

export async function runSync(conn: Connectors, trigger: SyncRun['trigger'], entities: EntityName[] = SYNC_ORDER) {
  if (running) throw new Error('A sync is already running');
  running = true;

  const run: SyncRun = { trigger, status: 'running', startedAt: new Date(), stats: {} };
  const { insertedId: runId } = await col.syncRuns().insertOne(run);

  try {
    for (const entity of entities) {
      const stats = await syncEntity(conn, getEntityMap(entity), runId);
      run.stats[entity] = stats;
      await col.syncRuns().updateOne({ _id: runId }, { $set: { [`stats.${entity}`]: stats } });
    }
    const failed = Object.values(run.stats).some((s) => s && s.failed > 0);
    run.status = failed ? 'partial' : 'success';
  } catch (err) {
    run.status = 'failed';
    run.error = (err as Error).message;
  } finally {
    running = false;
    run.finishedAt = new Date();
    await col.syncRuns().updateOne(
      { _id: runId },
      { $set: { status: run.status, finishedAt: run.finishedAt, error: run.error } },
    );
  }
  return { ...run, _id: runId };
}

async function syncEntity(conn: Connectors, map: EntityMap, runId: ObjectId): Promise<EntityStats> {
  const stats: EntityStats = { created: 0, updated: 0, unchanged: 0, matched: 0, conflicts: 0, failed: 0, deferred: 0 };
  const startedAt = new Date();

  // 1. Pull changes
  const sinceSugar = await getCheckpoint(map.name, 'sugar');
  const sinceSf = await getCheckpoint(map.name, 'sf');
  const [sugarChanged, sfChanged] = await Promise.all([
    conn.sugar.listChanged(map, new Date(sinceSugar.getTime() - OVERLAP_MS)),
    conn.sf.listChanged(map, new Date(sinceSf.getTime() - OVERLAP_MS)),
  ]);
  await addRetries(conn, map, sugarChanged, sfChanged);

  // 2 + 3. Filter echoes and pair records into work items
  const items = new Map<string, WorkItem>();
  for (const rec of sugarChanged) {
    const mapping = await col.mappings().findOne({ entity: map.name, sugarId: rec.id });
    if (mapping && mapping.sugarHash === hashFields(map, 'sugar', rec.fields)) {
      stats.unchanged++;
      await resolveDeadLetter(map.name, 'sugar', rec.id);
      continue;
    }
    const key = mapping ? `m:${mapping.sfId}` : `sugar:${rec.id}`;
    items.set(key, { sugar: rec, mapping: mapping ?? undefined, pairedBy: mapping ? 'mapping' : undefined });
  }
  for (const rec of sfChanged) {
    const mapping = await col.mappings().findOne({ entity: map.name, sfId: rec.id });
    if (mapping && mapping.sfHash === hashFields(map, 'sf', rec.fields)) {
      stats.unchanged++;
      await resolveDeadLetter(map.name, 'sf', rec.id);
      continue;
    }
    const key = mapping ? `m:${mapping.sfId}` : `sf:${rec.id}`;
    const existing = items.get(key);
    if (existing) existing.sf = rec; // changed on both sides since last sync
    else items.set(key, { sf: rec, mapping: mapping ?? undefined, pairedBy: mapping ? 'mapping' : undefined });
  }
  pairUnmappedInMemory(map, items);

  // 4 + 5. Resolve and write. Records of one entity are independent, so a few run in parallel.
  await forEachLimit([...items.values()], CONCURRENCY, async (item) => {
    const name = recordName(map, item);
    try {
      await processItem(conn, map, item, runId, stats);
    } catch (err) {
      const side: Side = item.sugar && (!item.sf || winnerOf(item) === 'sugar') ? 'sugar' : 'sf';
      const sourceId = (side === 'sugar' ? item.sugar?.id : item.sf?.id)!;
      const deferred = err instanceof MissingReferenceError;
      if (deferred) stats.deferred++;
      else stats.failed++;
      await logEvent(runId, map.name, deferred ? 'deferred' : 'error', side, {
        sugarId: item.sugar?.id ?? item.mapping?.sugarId,
        sfId: item.sf?.id ?? item.mapping?.sfId,
        name,
        message: (err as Error).message,
      });
      await recordDeadLetter(map.name, side, sourceId, name, (err as Error).message);
    }
  });

  // Advance checkpoints. Failed records are kept in deadLetters and retried by id, so this is safe.
  await setCheckpoint(map.name, 'sugar', latest(sugarChanged, sinceSugar, startedAt));
  await setCheckpoint(map.name, 'sf', latest(sfChanged, sinceSf, startedAt));
  return stats;
}

async function processItem(conn: Connectors, map: EntityMap, item: WorkItem, runId: ObjectId, stats: EntityStats) {
  // Unmapped records: look for an existing match on the other system before creating a duplicate
  if (!item.mapping) {
    if (item.sugar && !item.sf && !item.partnerSfId) {
      const probe = await translate(map, 'toSf', item.sugar.fields, refResolver('toSf'));
      const match = await conn.sf.findByNaturalKey(map, probe);
      if (match && !(await col.mappings().findOne({ entity: map.name, sfId: match.id }))) {
        item.partnerSfId = match.id;
        item.pairedBy = 'naturalKey';
      }
    } else if (item.sf && !item.sugar && !item.partnerSugarId) {
      const probe = await translate(map, 'toSugar', item.sf.fields, refResolver('toSugar'));
      const match = await conn.sugar.findByNaturalKey(map, probe);
      if (match && !(await col.mappings().findOne({ entity: map.name, sugarId: match.id }))) {
        item.partnerSugarId = match.id;
        item.pairedBy = 'naturalKey';
      }
    }
  }

  const winner = winnerOf(item);
  const name = recordName(map, item);

  if (item.sugar && item.sf && item.pairedBy === 'mapping') {
    stats.conflicts++;
    await col.conflicts().insertOne({
      runId,
      at: new Date(),
      entity: map.name,
      name,
      sugarId: item.sugar.id,
      sfId: item.sf.id,
      winner,
      sugarModifiedAt: item.sugar.modifiedAt,
      sfModifiedAt: item.sf.modifiedAt,
      sugarFields: item.sugar.fields,
      sfFields: item.sf.fields,
    });
    await logEvent(runId, map.name, 'conflict', winner, {
      sugarId: item.sugar.id,
      sfId: item.sf.id,
      name,
      message: `Edited in both CRMs; kept the ${winner === 'sugar' ? 'SugarCRM' : 'Salesforce'} version (most recent edit wins)`,
    });
  }

  if (winner === 'sugar') {
    const source = item.sugar!;
    const fields = await translate(map, 'toSf', source.fields, refResolver('toSf'));
    let sfId = item.mapping?.sfId ?? item.sf?.id ?? item.partnerSfId;
    let action: EventAction;
    if (sfId) {
      await conn.sf.update(map, sfId, fields);
      if (!item.mapping) await conn.sf.setSugarId(map, sfId, source.id);
      action = item.mapping ? 'updated' : 'matched';
    } else {
      sfId = await conn.sf.create(map, fields, source.id);
      action = 'created';
    }
    const written = await conn.sf.get(map, sfId);
    await saveMapping(map, source.id, sfId, hashFields(map, 'sugar', source.fields), hashFields(map, 'sf', written?.fields ?? {}), name);
    bump(stats, action);
    await logEvent(runId, map.name, action, 'sugar', { sugarId: source.id, sfId, name });
    await resolveDeadLetter(map.name, 'sugar', source.id);
  } else {
    const source = item.sf!;
    const fields = await translate(map, 'toSugar', source.fields, refResolver('toSugar'));
    let sugarId = item.mapping?.sugarId ?? item.sugar?.id ?? item.partnerSugarId;
    let action: EventAction;
    if (sugarId) {
      await conn.sugar.update(map, sugarId, fields);
      action = item.mapping ? 'updated' : 'matched';
    } else {
      sugarId = await conn.sugar.create(map, fields);
      action = 'created';
    }
    let sfFields = source.fields;
    if (action !== 'updated') {
      await conn.sf.setSugarId(map, source.id, sugarId);
      // Saving can make Salesforce normalize data (e.g. legacy "USA" becomes "United States"
      // under State & Country Picklists). Hash what is stored now, and pass the change on to Sugar.
      const stamped = await conn.sf.get(map, source.id);
      if (stamped && hashFields(map, 'sf', stamped.fields) !== hashFields(map, 'sf', source.fields)) {
        sfFields = stamped.fields;
        await conn.sugar.update(map, sugarId, await translate(map, 'toSugar', sfFields, refResolver('toSugar')));
      }
    }
    const written = await conn.sugar.get(map, sugarId);
    await saveMapping(map, sugarId, source.id, hashFields(map, 'sugar', written?.fields ?? {}), hashFields(map, 'sf', sfFields), name);
    bump(stats, action);
    await logEvent(runId, map.name, action, 'sf', { sugarId, sfId: source.id, name });
    await resolveDeadLetter(map.name, 'sf', source.id);
  }
}

/** Most recent edit wins. A tie goes to Salesforce, the system of record for the sales team. */
export function winnerOf(item: Pick<WorkItem, 'sugar' | 'sf'>): Side {
  if (item.sugar && !item.sf) return 'sugar';
  if (item.sf && !item.sugar) return 'sf';
  return item.sugar!.modifiedAt.getTime() > item.sf!.modifiedAt.getTime() ? 'sugar' : 'sf';
}

/** On first sync both sides may hold the same record. Pair them by natural key without extra API calls. */
function pairUnmappedInMemory(map: EntityMap, items: Map<string, WorkItem>) {
  const sfByKey = new Map<string, string>();
  for (const [key, item] of items) {
    if (!item.mapping && item.sf && !item.sugar) {
      const k = naturalKey(map, 'sf', item.sf.fields);
      if (k) sfByKey.set(k, key);
    }
  }
  for (const [key, item] of items) {
    if (item.mapping || !item.sugar || item.sf) continue;
    const k = naturalKey(map, 'sugar', item.sugar.fields);
    const sfKey = k ? sfByKey.get(k) : undefined;
    if (!sfKey) continue;
    item.sf = items.get(sfKey)!.sf;
    item.pairedBy = 'naturalKey';
    items.delete(sfKey);
    sfByKey.delete(k!);
  }
}

function naturalKey(map: EntityMap, side: Side, fields: Record<string, unknown>): string | null {
  const parts = map.naturalKey.map((k) => normalize(fields[side === 'sugar' ? k.sugar : k.sf]));
  if (parts.some((p) => p === null)) return null;
  return parts.map((p) => String(p).toLowerCase()).join('|');
}

function refResolver(direction: 'toSf' | 'toSugar'): RefResolver {
  return async (entity, sourceId) => {
    const m = await col.mappings().findOne(direction === 'toSf' ? { entity, sugarId: sourceId } : { entity, sfId: sourceId });
    return m ? (direction === 'toSf' ? m.sfId : m.sugarId) : null;
  };
}

function recordName(map: EntityMap, item: WorkItem): string | undefined {
  const f = item.sugar?.fields ?? {};
  const s = item.sf?.fields ?? {};
  if (map.name === 'leads') {
    return [f.first_name ?? s.FirstName, f.last_name ?? s.LastName].filter(Boolean).join(' ') || undefined;
  }
  return (f.name ?? s.Name ?? item.mapping?.name) as string | undefined;
}

function bump(stats: EntityStats, action: EventAction) {
  if (action === 'created') stats.created++;
  else if (action === 'updated') stats.updated++;
  else if (action === 'matched') stats.matched++;
}

function latest(records: CrmRecord[], previous: Date, cap: Date): Date {
  let max = previous;
  for (const r of records) if (r.modifiedAt > max) max = r.modifiedAt;
  return max > cap ? cap : max;
}

async function getCheckpoint(entity: EntityName, side: Side): Promise<Date> {
  const cp = await col.checkpoints().findOne({ _id: `${entity}:${side}` });
  return cp?.since ?? new Date(0);
}

async function setCheckpoint(entity: EntityName, side: Side, since: Date) {
  await col.checkpoints().updateOne({ _id: `${entity}:${side}` }, { $set: { since } }, { upsert: true });
}

async function saveMapping(map: EntityMap, sugarId: string, sfId: string, sugarHash: string, sfHash: string, name?: string) {
  const now = new Date();
  await col.mappings().updateOne(
    { entity: map.name, sugarId },
    { $set: { sfId, sugarHash, sfHash, name, lastSyncedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
}

async function logEvent(
  runId: ObjectId,
  entity: EntityName,
  action: EventAction,
  from: Side,
  extra: { sugarId?: string; sfId?: string; name?: string; message?: string },
) {
  await col.syncEvents().insertOne({
    runId,
    at: new Date(),
    entity,
    action,
    direction: from === 'sugar' ? 'sugar->sf' : 'sf->sugar',
    ...extra,
  });
}

async function recordDeadLetter(entity: EntityName, side: Side, sourceId: string, name: string | undefined, error: string) {
  const now = new Date();
  await col.deadLetters().updateOne(
    { _id: `${entity}:${side}:${sourceId}` },
    {
      $set: { entity, side, sourceId, name, error, lastAttemptAt: now, resolved: false },
      $inc: { attempts: 1 },
      $setOnInsert: { firstFailedAt: now },
    },
    { upsert: true },
  );
}

async function resolveDeadLetter(entity: EntityName, side: Side, sourceId: string) {
  await col.deadLetters().updateOne({ _id: `${entity}:${side}:${sourceId}`, resolved: false }, { $set: { resolved: true } });
}

/** Re-queue records that failed on earlier runs (they may be older than the checkpoint). */
async function addRetries(conn: Connectors, map: EntityMap, sugarChanged: CrmRecord[], sfChanged: CrmRecord[]) {
  const pending = await col.deadLetters().find({ entity: map.name, resolved: false, attempts: { $lt: MAX_ATTEMPTS } }).toArray();
  for (const dl of pending) {
    const list = dl.side === 'sugar' ? sugarChanged : sfChanged;
    if (list.some((r) => r.id === dl.sourceId)) continue;
    const connector: CrmConnector = dl.side === 'sugar' ? conn.sugar : conn.sf;
    const rec = await connector.get(map, dl.sourceId);
    if (rec) list.push(rec);
    else await col.deadLetters().updateOne({ _id: dl._id }, { $set: { resolved: true, error: 'Record no longer exists' } });
  }
}
