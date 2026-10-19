// The contract both CRM connectors implement. The sync engine only talks to this
// interface, so swapping SuiteCRM for a licensed SugarCRM instance (or adding HubSpot)
// means writing one new connector, not touching the engine.

import type { EntityMap } from '../mapping/fieldMaps.ts';
import type { Fields, Side } from '../mapping/transform.ts';

export interface CrmRecord {
  id: string;
  modifiedAt: Date;
  fields: Fields;
}

export interface CrmConnector {
  readonly system: Side;
  /** Records created or changed after `since`, oldest first. */
  listChanged(map: EntityMap, since: Date): Promise<CrmRecord[]>;
  get(map: EntityMap, id: string): Promise<CrmRecord | null>;
  /** Look for an existing record by its natural key (name, email) to avoid duplicates. */
  findByNaturalKey(map: EntityMap, fields: Fields): Promise<CrmRecord | null>;
  create(map: EntityMap, fields: Fields, sourceId?: string): Promise<string>;
  update(map: EntityMap, id: string, fields: Fields): Promise<void>;
}
