import { useCallback, useEffect, useState } from 'react';
import { api, type AppConfig, type Health, type Summary, type SyncRun } from './api.ts';
import { timeAgo } from './format.ts';
import { Overview } from './views/Overview.tsx';
import { SyncLog } from './views/SyncLog.tsx';
import { Records } from './views/Records.tsx';
import { Automation } from './views/Automation.tsx';

type Tab = 'overview' | 'log' | 'records' | 'automation';

export function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [health, setHealth] = useState<Health | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // bumping this re-fetches every view after a sync
  const [version, setVersion] = useState(0);

  const refreshHeader = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([api.health(), api.summary()]);
      setHealth(h);
      setSummary(s);
      setError(null);
    } catch (err) {
      setError(`Cannot reach the sync hub API: ${(err as Error).message}. Is the server running on port 3000?`);
    }
  }, []);

  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
    refreshHeader();
    // pick up scheduled syncs without a manual refresh
    const t = setInterval(() => {
      refreshHeader();
      setVersion((v) => v + 1);
    }, 30_000);
    return () => clearInterval(t);
  }, [refreshHeader]);

  async function syncNow() {
    setSyncing(true);
    setToast(null);
    try {
      const run = await api.sync();
      setToast(describeRun(run));
    } catch (err) {
      setToast(`Sync failed: ${(err as Error).message}`);
    } finally {
      setSyncing(false);
      await refreshHeader();
      setVersion((v) => v + 1);
      setTimeout(() => setToast(null), 8000);
    }
  }

  const attention = summary?.openDeadLetters ?? 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8h13l-3-3M20 16H7l3 3" />
            </svg>
          </div>
          <div>
            <h1>CRM Sync Hub</h1>
            <p>SugarCRM ⇄ Salesforce · leads, accounts, opportunities, deal reviews</p>
          </div>
        </div>
        <div className="health" aria-label="System health">
          <HealthPill label="SugarCRM" status={health?.sugar} />
          <HealthPill label="Salesforce" status={health?.salesforce} />
          <HealthPill label="MongoDB" status={health?.mongo} />
          <span className="pill" title={config ? `Schedule: ${config.syncCron}` : undefined}>
            Last sync {timeAgo(summary?.lastRun?.finishedAt ?? summary?.lastRun?.startedAt)}
          </span>
        </div>
        <button className="btn primary" onClick={syncNow} disabled={syncing || health?.syncRunning}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      </header>

      {error && <div className="error-box">{error}</div>}

      <nav className="tabs">
        {(
          [
            ['overview', 'Overview'],
            ['log', 'Sync log'],
            ['records', 'Linked records'],
            ['automation', 'Automation'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}
            {id === 'log' && attention > 0 && <span className="count">{attention}</span>}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <Overview summary={summary} version={version} />}
      {tab === 'log' && <SyncLog version={version} />}
      {tab === 'records' && <Records config={config} version={version} />}
      {tab === 'automation' && <Automation version={version} />}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function HealthPill({ label, status }: { label: string; status?: string }) {
  const state = status === undefined ? 'warning' : status === 'ok' ? 'good' : 'critical';
  const text = status === undefined ? 'checking' : status === 'ok' ? 'connected' : 'down';
  return (
    <span className="pill" title={status && status !== 'ok' ? status : undefined}>
      <span className={`dot ${state}`} aria-hidden />
      {label} <span className="muted">{text}</span>
    </span>
  );
}

function describeRun(run: SyncRun): string {
  const totals = Object.values(run.stats).reduce(
    (t, s) => ({ written: t.written + (s?.created ?? 0) + (s?.updated ?? 0) + (s?.matched ?? 0), conflicts: t.conflicts + (s?.conflicts ?? 0), failed: t.failed + (s?.failed ?? 0) }),
    { written: 0, conflicts: 0, failed: 0 },
  );
  if (run.status === 'failed') return `Sync failed: ${run.error}`;
  const parts = [`${totals.written} records synced`];
  if (totals.conflicts) parts.push(`${totals.conflicts} conflicts resolved`);
  if (totals.failed) parts.push(`${totals.failed} failed (will retry)`);
  if (run.workflowActions) parts.push(`${run.workflowActions} automation actions`);
  return `Sync complete: ${parts.join(', ')}.`;
}
