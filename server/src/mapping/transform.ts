// Turns a record from one CRM into the field shape of the other, and builds the
// content hash used for change and echo detection.

import { createHash } from 'node:crypto';
import type { EntityMap, FieldMap, FieldType, EntityName } from './fieldMaps.ts';

export type Side = 'sugar' | 'sf';
export type Fields = Record<string, unknown>;

/** Resolves an id from one system to the other, e.g. a Sugar account id to a Salesforce AccountId. */
export type RefResolver = (entity: EntityName, sourceId: string) => Promise<string | null>;

export class MissingReferenceError extends Error {
  entity: EntityName;
  sourceId: string;
  constructor(entity: EntityName, sourceId: string) {
    super(`Referenced ${entity} record ${sourceId} has not been synced yet`);
    this.entity = entity;
    this.sourceId = sourceId;
  }
}

/** Puts a value in one canonical form so the two systems can be compared. */
export function normalize(value: unknown, type: FieldType = 'string'): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  switch (type) {
    case 'number': {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'integer': {
      const n = Number(String(value).replace(/[^0-9.-]/g, ''));
      return Number.isFinite(n) ? Math.round(n) : null;
    }
    case 'date':
      return String(value).slice(0, 10);
    default:
      return String(value).trim();
  }
}

/** Stable hash of the mapped fields on one side. Same data in = same hash out. */
export function hashFields(map: EntityMap, side: Side, fields: Fields): string {
  const canonical = map.fields.map((f) => {
    const name = side === 'sugar' ? f.sugar : f.sf;
    return [name, normalize(fields[name], f.type)];
  });
  return createHash('sha1').update(JSON.stringify(canonical)).digest('hex');
}

/**
 * Translate a record's fields to the other system.
 * direction 'toSf' reads Sugar field names and writes Salesforce field names, 'toSugar' the reverse.
 */
export async function translate(
  map: EntityMap,
  direction: 'toSf' | 'toSugar',
  source: Fields,
  resolveRef: RefResolver,
): Promise<Fields> {
  const out: Fields = {};

  for (const f of map.fields) {
    const from = direction === 'toSf' ? f.sugar : f.sf;
    const to = direction === 'toSf' ? f.sf : f.sugar;
    let value = normalize(source[from], f.type);

    if (f.type === 'ref' && value !== null) {
      const targetId = await resolveRef(f.ref!, String(value));
      if (!targetId) throw new MissingReferenceError(f.ref!, String(value));
      value = targetId;
    }

    const dict = direction === 'toSf' ? f.toSf : f.toSugar;
    if (dict && value !== null && Object.hasOwn(dict, String(value))) {
      const translated = dict[String(value)];
      if (translated === null) continue; // "leave the target field alone"
      value = translated;
    }

    if (value === null) value = defaultFor(f, direction);
    out[to] = value;
  }

  return out;
}

function defaultFor(f: FieldMap, direction: 'toSf' | 'toSugar') {
  const d = direction === 'toSf' ? f.sfDefault : f.sugarDefault;
  return d === undefined ? null : d;
}
