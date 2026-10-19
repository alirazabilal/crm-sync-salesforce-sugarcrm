// MongoDB collections used by the sync hub.
//
//   mappings        Sugar id <-> Salesforce id per record, plus the last synced content hash of each side
//   checkpoints     "changed since" timestamp per entity and side (incremental sync)
//   syncRuns        one document per sync run with counts per entity
//   syncEvents      per-record audit log (created, updated, conflict, error...)
//   conflicts       records edited on both sides between two runs, and which side won
//   deadLetters     records that failed, retried on later runs until they succeed
//   workflowEvents  automation actions already taken (keeps rules idempotent)

import { MongoClient, type Db, type Collection, type ObjectId } from 'mongodb';
import { config } from './config.ts';
import type { EntityName } from './mapping/fieldMaps.ts';
import type { Side } from './mapping/transform.ts';

export interface Mapping {
  entity: EntityName;
  sugarId: string;
  sfId: string;
  name?: string;
  sugarHash: string;
  sfHash: string;
  createdAt: Date;
  lastSyncedAt: Date;
}

export interface Checkpoint {
  _id: string; // `${entity}:${side}`
  since: Date;
}

export interface EntityStats {
  created: number;
  updated: number;
  unchanged: number;
  matched: number;
  conflicts: number;
  failed: number;
  deferred: number;
}

export interface SyncRun {
  _id?: ObjectId;
  trigger: 'manual' | 'schedule' | 'startup' | 'cli';
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: Date;
  finishedAt?: Date;
  stats: Partial<Record<EntityName, EntityStats>>;
  workflowActions?: number;
  error?: string;
}

export type EventAction = 'created' | 'updated' | 'matched' | 'conflict' | 'error' | 'deferred';

export interface SyncEvent {
  runId: ObjectId;
  at: Date;
  entity: EntityName;
  action: EventAction;
  direction: 'sugar->sf' | 'sf->sugar';
  sugarId?: string;
  sfId?: string;
  name?: string;
  message?: string;
}

export interface Conflict {
  runId: ObjectId;
  at: Date;
  entity: EntityName;
  name?: string;
  sugarId: string;
  sfId: string;
  winner: Side;
  sugarModifiedAt: Date;
  sfModifiedAt: Date;
  sugarFields: Record<string, unknown>;
  sfFields: Record<string, unknown>;
}

export interface DeadLetter {
  _id: string; // `${entity}:${side}:${sourceId}`
  entity: EntityName;
  side: Side;
  sourceId: string;
  name?: string;
  error: string;
  attempts: number;
  firstFailedAt: Date;
  lastAttemptAt: Date;
  resolved: boolean;
}

export interface WorkflowEvent {
  _id: string; // `${rule}:${recordId}` so each rule fires once per record
  rule: string;
  recordId: string;
  recordName?: string;
  at: Date;
  detail: string;
  taskId?: string;
}

export interface PipelineSnapshot {
  _id?: ObjectId;
  at: Date;
  byStage: { stage: string; count: number; amount: number }[];
  openAmount: number;
  wonAmount: number;
  winRate: number;
}

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDb(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(config.mongoUrl, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  db = client.db();
  await ensureIndexes(db);
  return db;
}

export async function closeDb() {
  await client?.close();
  client = null;
  db = null;
}

function getDb(): Db {
  if (!db) throw new Error('Database not connected, call connectDb() first');
  return db;
}

export const col = {
  mappings: () => getDb().collection<Mapping>('mappings'),
  checkpoints: () => getDb().collection<Checkpoint>('checkpoints'),
  syncRuns: () => getDb().collection<SyncRun>('syncRuns'),
  syncEvents: () => getDb().collection<SyncEvent>('syncEvents'),
  conflicts: () => getDb().collection<Conflict>('conflicts'),
  deadLetters: () => getDb().collection<DeadLetter>('deadLetters'),
  workflowEvents: () => getDb().collection<WorkflowEvent>('workflowEvents'),
  pipelineSnapshots: () => getDb().collection<PipelineSnapshot>('pipelineSnapshots'),
} satisfies Record<string, () => Collection<any>>;

async function ensureIndexes(d: Db) {
  await d.collection('mappings').createIndex({ entity: 1, sugarId: 1 }, { unique: true });
  await d.collection('mappings').createIndex({ entity: 1, sfId: 1 }, { unique: true });
  await d.collection('syncEvents').createIndex({ at: -1 });
  await d.collection('syncEvents').createIndex({ runId: 1 });
  await d.collection('syncRuns').createIndex({ startedAt: -1 });
  await d.collection('conflicts').createIndex({ at: -1 });
  await d.collection('pipelineSnapshots').createIndex({ at: -1 });
}
