// Salesforce REST API connector.
// Auth: OAuth 2.0 client credentials flow against an External Client App.
// Tokens are cached and refreshed automatically when Salesforce returns 401.

import { config } from '../config.ts';
import { HttpError, request } from '../lib/http.ts';
import type { EntityMap } from '../mapping/fieldMaps.ts';
import type { Fields } from '../mapping/transform.ts';
import type { CrmConnector, CrmRecord } from './types.ts';

/** External ID field on Salesforce objects that holds the Sugar record id. */
export const SUGAR_ID_FIELD = 'Sugar_Id__c';

interface Token {
  accessToken: string;
  instanceUrl: string;
  userId: string; // the "Run As" user of the External Client App
}

export class SalesforceConnector implements CrmConnector {
  readonly system = 'sf' as const;
  private token: Token | null = null;
  private hasExternalIdField: boolean | null = null;

  private async authenticate(): Promise<Token> {
    const { loginUrl, clientId, clientSecret } = config.salesforce;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await request<{ access_token: string; instance_url: string; id: string }>(`${loginUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    // res.id looks like https://login.salesforce.com/id/<orgId>/<userId>
    this.token = { accessToken: res.access_token, instanceUrl: res.instance_url, userId: res.id.split('/').pop()! };
    return this.token;
  }

  async userId(): Promise<string> {
    return (this.token ?? (await this.authenticate())).userId;
  }

  async instanceUrl(): Promise<string> {
    return (this.token ?? (await this.authenticate())).instanceUrl;
  }

  /**
   * Metadata API (SOAP) createMetadata call. Only used by the setup script for things
   * the REST Tooling API cannot create, like custom objects and tabs.
   * `inner` is the XML body of one metadata item, with fields in WSDL order.
   */
  async createMetadata(type: string, inner: string): Promise<void> {
    const token = this.token ?? (await this.authenticate());
    const version = config.salesforce.apiVersion.replace(/^v/, '');
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:met="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soapenv:Header><met:SessionHeader><met:sessionId>${token.accessToken}</met:sessionId></met:SessionHeader></soapenv:Header>
  <soapenv:Body><met:createMetadata><met:metadata xsi:type="met:${type}">${inner}</met:metadata></met:createMetadata></soapenv:Body>
</soapenv:Envelope>`;
    const res = await fetch(`${token.instanceUrl}/services/Soap/m/${version}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '""' },
      body: envelope,
    });
    const text = await res.text();
    if (!res.ok || !text.includes('<success>true</success>')) {
      const message = text.match(/<message>([\s\S]*?)<\/message>/)?.[1] ?? text.match(/<faultstring>([\s\S]*?)<\/faultstring>/)?.[1] ?? text.slice(0, 300);
      throw new Error(`Metadata API createMetadata ${type} failed: ${message}`);
    }
  }

  /** Call the REST API. Paths starting with "/services" are used as-is, others go under /services/data/vXX.X */
  async api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const full = path.startsWith('/services') ? path : `/services/data/${config.salesforce.apiVersion}${path}`;
    for (let attempt = 0; ; attempt++) {
      const token = this.token ?? (await this.authenticate());
      try {
        return await request<T>(token.instanceUrl + full, {
          ...init,
          headers: {
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
            ...init.headers,
          },
        });
      } catch (err) {
        if (err instanceof HttpError && err.status === 401 && attempt === 0) {
          this.token = null; // expired session, get a fresh token and retry once
          continue;
        }
        throw err;
      }
    }
  }

  /** Run a SOQL query and follow pagination until all rows are loaded. */
  async query<T = any>(soql: string): Promise<T[]> {
    const rows: T[] = [];
    let res = await this.api<any>(`/query?q=${encodeURIComponent(soql)}`);
    rows.push(...res.records);
    while (!res.done && res.nextRecordsUrl) {
      res = await this.api<any>(res.nextRecordsUrl);
      rows.push(...res.records);
    }
    return rows;
  }

  private selectList(map: EntityMap): string {
    return ['Id', 'LastModifiedDate', ...map.fields.map((f) => f.sf)].join(', ');
  }

  private toRecord(map: EntityMap, row: any): CrmRecord {
    const fields: Fields = {};
    for (const f of map.fields) fields[f.sf] = row[f.sf] ?? null;
    return { id: row.Id, modifiedAt: new Date(row.LastModifiedDate), fields };
  }

  async listChanged(map: EntityMap, since: Date): Promise<CrmRecord[]> {
    const where = [`LastModifiedDate > ${soqlDateTime(since)}`];
    if (map.sfFilter) where.push(map.sfFilter);
    const rows = await this.query(
      `SELECT ${this.selectList(map)} FROM ${map.sfObject} WHERE ${where.join(' AND ')} ORDER BY LastModifiedDate`,
    );
    return rows.map((r) => this.toRecord(map, r));
  }

  async get(map: EntityMap, id: string): Promise<CrmRecord | null> {
    const rows = await this.query(`SELECT ${this.selectList(map)} FROM ${map.sfObject} WHERE Id = '${soqlEscape(id)}'`);
    return rows[0] ? this.toRecord(map, rows[0]) : null;
  }

  async findByNaturalKey(map: EntityMap, fields: Fields): Promise<CrmRecord | null> {
    const conditions: string[] = [];
    for (const key of map.naturalKey) {
      const value = fields[key.sf];
      if (value === null || value === undefined || value === '') return null;
      conditions.push(`${key.sf} = '${soqlEscape(String(value))}'`);
    }
    if (map.sfFilter) conditions.push(map.sfFilter);
    const rows = await this.query(
      `SELECT ${this.selectList(map)} FROM ${map.sfObject} WHERE ${conditions.join(' AND ')} ORDER BY CreatedDate LIMIT 1`,
    );
    return rows[0] ? this.toRecord(map, rows[0]) : null;
  }

  /**
   * Create a record. When the Sugar id is known we use an upsert on the Sugar_Id__c
   * external id, so a retry after a crash updates the same record instead of duplicating it.
   */
  async create(map: EntityMap, fields: Fields, sugarId?: string): Promise<string> {
    if (sugarId && (await this.externalIdAvailable())) {
      const res = await this.api<{ id: string }>(
        `/sobjects/${map.sfObject}/${SUGAR_ID_FIELD}/${encodeURIComponent(sugarId)}`,
        { method: 'PATCH', body: JSON.stringify(fields) },
      );
      if (res?.id) return res.id;
      // Older API versions return 204 on update, so look the record up
      const rows = await this.query(
        `SELECT Id FROM ${map.sfObject} WHERE ${SUGAR_ID_FIELD} = '${soqlEscape(sugarId)}' LIMIT 1`,
      );
      return rows[0].Id;
    }
    const res = await this.api<{ id: string }>(`/sobjects/${map.sfObject}`, {
      method: 'POST',
      body: JSON.stringify(fields),
    });
    return res.id;
  }

  async update(map: EntityMap, id: string, fields: Fields): Promise<void> {
    await this.api(`/sobjects/${map.sfObject}/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
  }

  /** Stamp the Sugar id on a Salesforce record (used when we matched an existing record). */
  async setSugarId(map: EntityMap, id: string, sugarId: string): Promise<void> {
    if (!(await this.externalIdAvailable())) return;
    await this.update(map, id, { [SUGAR_ID_FIELD]: sugarId });
  }

  /** True once scripts/setup-salesforce.ts has created the Sugar_Id__c fields. */
  private async externalIdAvailable(): Promise<boolean> {
    if (this.hasExternalIdField === null) {
      const desc = await this.api<any>('/sobjects/Account/describe');
      this.hasExternalIdField = desc.fields.some((f: any) => f.name === SUGAR_ID_FIELD);
    }
    return this.hasExternalIdField === true;
  }
}

/** SOQL datetime literal, e.g. 2026-10-03T10:00:00Z (no quotes, no milliseconds). */
export function soqlDateTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function soqlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
