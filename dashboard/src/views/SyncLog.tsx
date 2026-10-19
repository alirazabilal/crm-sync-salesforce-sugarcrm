import { useState } from 'react';
import { api, ENTITY_LABELS, type EntityName, type SyncEvent } from '../api.ts';
import { useData } from '../useData.ts';
import { dateTime, SYSTEM } from '../format.ts';

const ACTION_DOT: Record<SyncEvent['action'], string> = {
  created: 'good',
  updated: 'good',
  matched: 'good',
  conflict: 'warning',
  deferred: 'warning',
  error: 'critical',
};

export function SyncLog({ version }: { version: number }) {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const q = `${entity ? `&entity=${entity}` : ''}${action ? `&action=${action}` : ''}`;
  const events = useData(() => api.events(q), [version, q]);
  const conflicts = useData(api.conflicts, [version]);
  const dead = useData(api.deadLetters, [version]);

  return (
    <>
      {dead.data && dead.data.length > 0 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>Failed records (retrying)</h2>
          <p className="sub">Kept in a dead-letter queue and retried on every sync, up to 5 attempts</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Record</th>
                  <th>Type</th>
                  <th>From</th>
                  <th>Error</th>
                  <th className="num">Attempts</th>
                </tr>
              </thead>
              <tbody>
                {dead.data.map((d) => (
                  <tr key={d._id}>
                    <td>{d.name ?? '(no name)'}</td>
                    <td>{ENTITY_LABELS[d.entity]}</td>
                    <td>{SYSTEM[d.side]}</td>
                    <td className="mono" style={{ maxWidth: 480 }}>
                      {d.error}
                    </td>
                    <td className="num">{d.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Conflicts resolved</h2>
        <p className="sub">Records edited in both CRMs between two syncs. Rule: the most recent edit wins (ties go to Salesforce).</p>
        {!conflicts.data ? (
          <div className="empty">{conflicts.error ?? 'Loading…'}</div>
        ) : conflicts.data.length === 0 ? (
          <div className="empty">No conflicts so far. Edit the same record in both CRMs, then sync, to see one.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Record</th>
                  <th>Type</th>
                  <th>SugarCRM edit</th>
                  <th>Salesforce edit</th>
                  <th>Kept</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.data.map((c) => (
                  <tr key={c._id}>
                    <td>{dateTime(c.at)}</td>
                    <td>{c.name}</td>
                    <td>{ENTITY_LABELS[c.entity]}</td>
                    <td className="muted">{dateTime(c.sugarModifiedAt)}</td>
                    <td className="muted">{dateTime(c.sfModifiedAt)}</td>
                    <td>
                      <span className="badge">{SYSTEM[c.winner]} version</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <h2>Record activity</h2>
            <p className="sub">Every record the sync wrote, newest first (audit trail)</p>
          </div>
        </div>
        <div className="filters">
          <select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filter by type">
            <option value="">All types</option>
            {(Object.keys(ENTITY_LABELS) as EntityName[]).map((e) => (
              <option key={e} value={e}>
                {ENTITY_LABELS[e]}
              </option>
            ))}
          </select>
          <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">
            <option value="">All actions</option>
            {Object.keys(ACTION_DOT).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        {!events.data ? (
          <div className="empty">{events.error ?? 'Loading…'}</div>
        ) : events.data.length === 0 ? (
          <div className="empty">No activity matches these filters.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Record</th>
                  <th>Type</th>
                  <th>Direction</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((e) => (
                  <tr key={e._id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{dateTime(e.at)}</td>
                    <td>
                      <span className="badge">
                        <span className={`dot ${ACTION_DOT[e.action]}`} aria-hidden />
                        {e.action}
                      </span>
                    </td>
                    <td>{e.name ?? <span className="muted">(no name)</span>}</td>
                    <td>{ENTITY_LABELS[e.entity]}</td>
                    <td className="dir">{e.direction === 'sugar->sf' ? 'SugarCRM → Salesforce' : 'Salesforce → SugarCRM'}</td>
                    <td className="muted" style={{ fontSize: 12.5 }}>
                      {e.message}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
