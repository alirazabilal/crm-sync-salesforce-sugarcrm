import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ENTITY_LABELS, type EntityName, type Summary, type SyncRun } from '../api.ts';
import { useData } from '../useData.ts';
import { dateTime, duration, money, moneyFull, pct } from '../format.ts';

// Salesforce and SugarCRM share these default stages, in funnel order
const STAGE_ORDER = [
  'Prospecting',
  'Qualification',
  'Needs Analysis',
  'Value Proposition',
  'Id. Decision Makers',
  'Perception Analysis',
  'Proposal/Price Quote',
  'Negotiation/Review',
  'Closed Won',
  'Closed Lost',
];

export function Overview({ summary, version }: { summary: Summary | null; version: number }) {
  const pipeline = useData(api.pipeline, [version]);
  const runs = useData(api.runs, [version]);
  const hot = useData(api.hotLeads, [version]);

  const p = pipeline.data;
  const stages = p
    ? [...p.byStage].sort((a, b) => rank(a.stage) - rank(b.stage)).filter((s) => !s.stage.startsWith('Closed'))
    : [];
  const linked = Object.values(summary?.mappings ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  const failed = summary?.openDeadLetters ?? 0;

  return (
    <>
      <section className="grid kpis">
        <Kpi label="Open pipeline" value={p ? money(p.openAmount) : '-'} note={p ? `${p.openCount} open opportunities` : ''} />
        <Kpi label="Closed won" value={p ? money(p.wonAmount) : '-'} note="Revenue from won deals" />
        <Kpi label="Win rate" value={p ? pct(p.winRate) : '-'} note="Won ÷ (won + lost)" />
        <Kpi label="Records in sync" value={String(linked)} note={mappingNote(summary)} />
        <Kpi
          label="Failed records"
          value={String(failed)}
          note={failed > 0 ? 'Retrying automatically' : `${summary?.conflicts ?? 0} conflicts auto-resolved`}
          alert={failed > 0}
        />
      </section>

      <section className="grid two">
        <div className="card">
          <h2>Open pipeline by stage</h2>
          <p className="sub">Opportunity amount per sales stage, live from Salesforce</p>
          {stages.length === 0 ? (
            <div className="empty">{pipeline.error ?? 'Loading…'}</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(220, stages.length * 36)}>
              <BarChart data={stages} layout="vertical" margin={{ left: 8, right: 48, top: 4, bottom: 4 }} barCategoryGap={6}>
                <CartesianGrid horizontal={false} stroke="var(--grid)" />
                <XAxis type="number" tickFormatter={money} stroke="var(--axis)" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                <YAxis type="category" dataKey="stage" width={140} stroke="var(--axis)" tick={{ fill: 'var(--ink-2)', fontSize: 12 }} tickLine={false} />
                <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<StageTip />} />
                <Bar dataKey="amount" fill="var(--series-1)" radius={[0, 4, 4, 0]} maxBarSize={20} label={{ position: 'right', formatter: (v: unknown) => money(Number(v)), fill: 'var(--ink-2)', fontSize: 12 }} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2>Hot leads</h2>
          <p className="sub">Scored by the lead-scoring rule; {hot.data?.threshold ?? 70}+ gets a call task automatically</p>
          {!hot.data ? (
            <div className="empty">{hot.error ?? 'Loading…'}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th style={{ width: '38%' }}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {hot.data.leads.map((l) => (
                    <tr key={l.id} title={l.reasons.join('\n')}>
                      <td>
                        {l.name}
                        <div className="muted" style={{ fontSize: 12 }}>
                          {[l.title, l.company].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td>
                        <div className="meter">
                          <div className="meter-track">
                            <div className="meter-fill" style={{ width: `${l.score}%` }} />
                          </div>
                          <span className="num" style={{ minWidth: 24, textAlign: 'right' }}>
                            {l.score}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {p && p.history.length > 1 && (
        <section className="card" style={{ marginBottom: 16 }}>
          <h2>Open pipeline over time</h2>
          <p className="sub">Snapshot taken after every sync</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={p.history} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              <XAxis dataKey="at" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} stroke="var(--axis)" tick={{ fill: 'var(--muted)', fontSize: 12 }} minTickGap={40} />
              <YAxis tickFormatter={money} stroke="var(--axis)" tick={{ fill: 'var(--muted)', fontSize: 12 }} width={64} />
              <Tooltip content={<TrendTip />} cursor={{ stroke: 'var(--axis)' }} />
              <Line type="monotone" dataKey="openAmount" stroke="var(--series-1)" strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </section>
      )}

      <section className="card">
        <h2>Recent sync runs</h2>
        <p className="sub">Each run pulls changes from both CRMs, resolves conflicts, writes, then runs automation</p>
        <RunsTable runs={runs.data} error={runs.error} />
      </section>
    </>
  );
}

function rank(stage: string) {
  const i = STAGE_ORDER.indexOf(stage);
  return i === -1 ? 99 : i;
}

function mappingNote(summary: Summary | null) {
  const m = summary?.mappings ?? {};
  return (Object.keys(ENTITY_LABELS) as EntityName[])
    .filter((e) => m[e])
    .map((e) => `${m[e]} ${ENTITY_LABELS[e].toLowerCase()}`)
    .join(' · ');
}

function Kpi({ label, value, note, alert }: { label: string; value: string; note?: string; alert?: boolean }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      <div className={`note ${alert ? 'alert' : ''}`}>{note}</div>
    </div>
  );
}

function StageTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tip">
      <strong>{d.stage}</strong>
      <div className="row">{moneyFull(d.amount)}</div>
      <div className="row">
        {d.count} {d.count === 1 ? 'opportunity' : 'opportunities'}
      </div>
    </div>
  );
}

function TrendTip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tip">
      <strong>{dateTime(d.at)}</strong>
      <div className="row">Open pipeline {moneyFull(d.openAmount)}</div>
      <div className="row">Win rate {pct(d.winRate)}</div>
    </div>
  );
}

const STATUS_DOT: Record<SyncRun['status'], string> = { success: 'good', partial: 'warning', failed: 'critical', running: 'warning' };

export function RunsTable({ runs, error }: { runs: SyncRun[] | null; error: string | null }) {
  if (!runs) return <div className="empty">{error ?? 'Loading…'}</div>;
  if (runs.length === 0) return <div className="empty">No syncs yet. Click “Sync now”.</div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Started</th>
            <th>Trigger</th>
            <th>Status</th>
            <th className="num">Created</th>
            <th className="num">Updated</th>
            <th className="num">Matched</th>
            <th className="num">Conflicts</th>
            <th className="num">Failed</th>
            <th className="num">Automation</th>
            <th className="num">Duration</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const t = Object.values(r.stats).reduce(
              (a, s) => ({
                created: a.created + (s?.created ?? 0),
                updated: a.updated + (s?.updated ?? 0),
                matched: a.matched + (s?.matched ?? 0),
                conflicts: a.conflicts + (s?.conflicts ?? 0),
                failed: a.failed + (s?.failed ?? 0) + (s?.deferred ?? 0),
              }),
              { created: 0, updated: 0, matched: 0, conflicts: 0, failed: 0 },
            );
            return (
              <tr key={r._id}>
                <td>{dateTime(r.startedAt)}</td>
                <td className="muted">{r.trigger}</td>
                <td>
                  <span className="badge" title={r.error}>
                    <span className={`dot ${STATUS_DOT[r.status]}`} aria-hidden />
                    {r.status}
                  </span>
                </td>
                <td className="num">{t.created}</td>
                <td className="num">{t.updated}</td>
                <td className="num">{t.matched}</td>
                <td className="num">{t.conflicts}</td>
                <td className="num">{t.failed}</td>
                <td className="num">{r.workflowActions ?? 0}</td>
                <td className="num muted">{duration(r.startedAt, r.finishedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
