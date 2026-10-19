// SugarCRM REST API (v4_1) connector.
// SuiteCRM keeps SugarCRM's v4_1 REST service unchanged, so this connector works against
// SugarCRM CE / SuiteCRM. A licensed SugarCRM (v11 REST) would get its own connector
// implementing the same CrmConnector interface.

import { createHash } from 'node:crypto';
import { config } from '../config.ts';
import { request } from '../lib/http.ts';
import type { EntityMap } from '../mapping/fieldMaps.ts';
import type { Fields } from '../mapping/transform.ts';
import type { CrmConnector, CrmRecord } from './types.ts';

// SuiteCRM 8 serves the legacy app under /legacy, SuiteCRM 7 / SugarCRM CE at the root.
const REST_PATHS = ['/legacy/service/v4_1/rest.php', '/service/v4_1/rest.php'];

/** Sugar error number for an expired or unknown session */
const INVALID_SESSION = '11';

export class SugarConnector implements CrmConnector {
  readonly system = 'sugar' as const;
  private session: string | null = null;
  private endpoint: string | null = null;

  private async findEndpoint(): Promise<string> {
    if (this.endpoint) return this.endpoint;
    for (const path of REST_PATHS) {
      const url = config.sugar.url + path;
      try {
        const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ method: 'get_server_info', input_type: 'JSON', response_type: 'JSON' }) });
        const text = await res.text();
        if (res.ok && text.includes('flavor')) {
          this.endpoint = url;
          return url;
        }
      } catch {
        // try the next path
      }
    }
    throw new Error(`SugarCRM REST API not reachable at ${config.sugar.url}`);
  }

  /**
   * `args` must be listed in the same order as the PHP method's parameters. They are sent
   * as a positional JSON array: on PHP 8 a JSON object becomes named arguments and fails.
   */
  private async rawCall<T = any>(method: string, args: Record<string, unknown>): Promise<T> {
    const endpoint = await this.findEndpoint();
    const body = new URLSearchParams({
      method,
      input_type: 'JSON',
      response_type: 'JSON',
      rest_data: JSON.stringify(Object.values(args)),
    });
    return request<T>(endpoint, { method: 'POST', body });
  }

  private async login(): Promise<string> {
    const res = await this.rawCall<any>('login', {
      user_auth: {
        user_name: config.sugar.username,
        password: createHash('md5').update(config.sugar.password).digest('hex'),
      },
      application_name: 'crm-sync-hub',
      name_value_list: [],
    });
    if (!res?.id) throw new Error(`SugarCRM login failed: ${res?.description ?? JSON.stringify(res)}`);
    this.session = res.id;
    return res.id;
  }

  async serverInfo(): Promise<{ flavor: string; version: string }> {
    return this.rawCall('get_server_info', {});
  }

  /** Call an API method with the session, logging in again if the session expired. */
  async call<T = any>(method: string, args: Record<string, unknown>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const session = this.session ?? (await this.login());
      const res = await this.rawCall<any>(method, { session, ...args });
      if (res && res.number !== undefined && res.name) {
        if (String(res.number) === INVALID_SESSION && attempt === 0) {
          this.session = null;
          continue;
        }
        throw new Error(`SugarCRM ${method} failed: ${res.name} - ${res.description}`);
      }
      return res as T;
    }
  }

  private table(map: EntityMap): string {
    return map.sugarModule === 'DealReviews' ? 'deal_reviews' : map.sugarModule.toLowerCase();
  }

  private selectFields(map: EntityMap): string[] {
    // account_id on Opportunities is a relationship, read separately through the "accounts" link
    return ['id', 'date_modified', ...map.fields.filter((f) => !isRelationField(map, f.sugar)).map((f) => f.sugar)];
  }

  private linkFields(map: EntityMap) {
    return map.name === 'opportunities' ? [{ name: 'accounts', value: ['id'] }] : [];
  }

  private toRecord(map: EntityMap, entry: any, relations?: any): CrmRecord {
    const values: Record<string, any> = {};
    for (const [key, nv] of Object.entries<any>(entry.name_value_list ?? {})) values[key] = decodeHtml(nv.value);

    const fields: Fields = {};
    for (const f of map.fields) fields[f.sugar] = values[f.sugar] ?? null;

    if (map.name === 'opportunities') {
      // SuiteCRM returns [{ name: 'accounts', records: [{ id: { value } }] }]; SugarCRM wraps it in link_list
      const links: any[] = Array.isArray(relations) ? relations : (relations?.link_list ?? []);
      const first = links.find((l) => l.name === 'accounts')?.records?.[0];
      fields.account_id = first ? (first.link_value?.id?.value ?? first.id?.value ?? null) : null;
    }

    return { id: entry.id, modifiedAt: parseSugarDate(values.date_modified), fields };
  }

  private async list(map: EntityMap, where: string, orderBy: string, limit?: number): Promise<CrmRecord[]> {
    const records: CrmRecord[] = [];
    let offset = 0;
    while (true) {
      const res = await this.call<any>('get_entry_list', {
        module_name: map.sugarModule,
        query: where,
        order_by: orderBy,
        offset,
        select_fields: this.selectFields(map),
        link_name_to_fields_array: this.linkFields(map),
        max_results: limit ?? 100,
        deleted: 0,
        favorites: false,
      });
      const entries = res.entry_list ?? [];
      entries.forEach((entry: any, i: number) => records.push(this.toRecord(map, entry, res.relationship_list?.[i])));
      if (limit || entries.length === 0 || res.next_offset >= res.total_count) break;
      offset = res.next_offset;
    }
    return records;
  }

  async listChanged(map: EntityMap, since: Date): Promise<CrmRecord[]> {
    const t = this.table(map);
    return this.list(map, `${t}.date_modified > '${toSugarDate(since)}'`, `${t}.date_modified ASC`);
  }

  async get(map: EntityMap, id: string): Promise<CrmRecord | null> {
    const res = await this.call<any>('get_entry', {
      module_name: map.sugarModule,
      id,
      select_fields: this.selectFields(map),
      link_name_to_fields_array: this.linkFields(map),
    });
    const entry = res.entry_list?.[0];
    if (!entry || entry.name_value_list?.deleted?.value === '1' || !entry.name_value_list?.id) return null;
    return this.toRecord(map, entry, res.relationship_list?.[0]);
  }

  async findByNaturalKey(map: EntityMap, fields: Fields): Promise<CrmRecord | null> {
    const t = this.table(map);
    const conditions: string[] = [];
    for (const key of map.naturalKey) {
      const value = fields[key.sugar];
      if (value === null || value === undefined || value === '') return null;
      const v = sqlEscape(String(value));
      if (key.sugar === 'email1') {
        // Emails live in a separate table in Sugar
        conditions.push(
          `${t}.id IN (SELECT eabr.bean_id FROM email_addr_bean_rel eabr JOIN email_addresses ea ON ea.id = eabr.email_address_id ` +
            `WHERE eabr.deleted = 0 AND ea.email_address_caps = '${v.toUpperCase()}')`,
        );
      } else {
        conditions.push(`${t}.${key.sugar} = '${v}'`);
      }
    }
    const rows = await this.list(map, conditions.join(' AND '), `${t}.date_entered ASC`, 1);
    return rows[0] ?? null;
  }

  async create(map: EntityMap, fields: Fields): Promise<string> {
    const res = await this.call<any>('set_entry', { module_name: map.sugarModule, name_value_list: toNameValueList(fields) });
    if (!res?.id || res.id === -1) throw new Error(`SugarCRM create ${map.sugarModule} failed`);
    await this.saveRelations(map, res.id, fields, null);
    return res.id;
  }

  async update(map: EntityMap, id: string, fields: Fields): Promise<void> {
    const before = map.name === 'opportunities' ? await this.get(map, id) : null;
    await this.call('set_entry', { module_name: map.sugarModule, name_value_list: toNameValueList({ id, ...fields }) });
    await this.saveRelations(map, id, fields, before?.fields.account_id as string | null | undefined);
  }

  /**
   * Opportunity -> Account is a many-to-many link table in Sugar, so set it explicitly,
   * removing the previous account when it changed.
   */
  private async saveRelations(map: EntityMap, id: string, fields: Fields, previousAccountId?: string | null) {
    if (map.name !== 'opportunities') return;
    const accountId = fields.account_id as string | null;
    if (accountId === previousAccountId) return;
    const link = (related: string, remove: boolean) =>
      this.call('set_relationship', {
        module_name: 'Opportunities',
        module_id: id,
        link_field_name: 'accounts',
        related_ids: [related],
        name_value_list: [],
        delete: remove ? 1 : 0,
      });
    if (previousAccountId) await link(previousAccountId, true);
    if (accountId) await link(accountId, false);
  }
}

function isRelationField(map: EntityMap, field: string) {
  return map.name === 'opportunities' && field === 'account_id';
}

function toNameValueList(fields: Fields) {
  return Object.entries(fields).map(([name, value]) => ({ name, value: value === null || value === undefined ? '' : String(value) }));
}

/** Sugar stores dates in UTC as "YYYY-MM-DD HH:MM:SS". */
export function toSugarDate(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

export function parseSugarDate(value: string | undefined): Date {
  if (!value) return new Date(0);
  return new Date(value.replace(' ', 'T') + 'Z');
}

function sqlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/** The v4_1 API returns HTML-encoded strings, e.g. O&#039;Reilly */
export function decodeHtml(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
