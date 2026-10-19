import { useEffect, useState } from 'react';
import { api, ENTITY_LABELS, ENTITY_OBJECTS, type AppConfig, type EntityName } from '../api.ts';
import { useData } from '../useData.ts';
import { timeAgo } from '../format.ts';

// SuiteCRM 8 routes (the custom module is registered in suitecrm/.../ModuleNameMap)
const SUITE_ROUTES: Record<EntityName, string> = {
  accounts: 'accounts',
  leads: 'leads',
  opportunities: 'opportunities',
  dealReviews: 'deal-reviews',
};

export function Records({ config, version }: { config: AppConfig | null; version: number }) {
  const [entity, setEntity] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  // wait for the user to stop typing before querying
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = `${entity ? `&entity=${entity}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`;
  const rows = useData(() => api.mappings(query), [version, query]);

  const sugarLink = (e: EntityName, id: string) => (config ? `${config.sugarUrl}/#/${SUITE_ROUTES[e]}/record/${id}` : '#');
  const sfLink = (e: EntityName, id: string) => (config ? `${config.salesforceUrl}/lightning/r/${ENTITY_OBJECTS[e].sf}/${id}/view` : '#');

  return (
    <section className="card">
      <h2>Linked records</h2>
      <p className="sub">The id map stored in MongoDB: each row is one record that exists in both CRMs and is kept in sync</p>
      <div className="filters">
        <input type="search" placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search records" />
        <select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {(Object.keys(ENTITY_LABELS) as EntityName[]).map((e) => (
            <option key={e} value={e}>
              {ENTITY_LABELS[e]}
            </option>
          ))}
        </select>
        {rows.data && <span className="muted" style={{ alignSelf: 'center' }}>{rows.data.length} shown</span>}
      </div>
      {!rows.data ? (
        <div className="empty">{rows.error ?? 'Loading…'}</div>
      ) : rows.data.length === 0 ? (
        <div className="empty">No linked records match.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>SugarCRM id</th>
                <th>Salesforce id</th>
                <th>Last synced</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((m) => (
                <tr key={m._id}>
                  <td>{m.name ?? <span className="muted">(no name)</span>}</td>
                  <td>{ENTITY_LABELS[m.entity]}</td>
                  <td>
                    <a className="mono" href={sugarLink(m.entity, m.sugarId)} target="_blank" rel="noreferrer" title="Open in SugarCRM">
                      {m.sugarId.slice(0, 8)}…
                    </a>
                  </td>
                  <td>
                    <a className="mono" href={sfLink(m.entity, m.sfId)} target="_blank" rel="noreferrer" title="Open in Salesforce">
                      {m.sfId}
                    </a>
                  </td>
                  <td className="muted">{timeAgo(m.lastSyncedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
