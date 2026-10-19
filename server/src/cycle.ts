// One full cycle: sync both CRMs, run workflow automation, snapshot the pipeline.

import { col, type SyncRun } from './db.ts';
import { runSync, type Connectors } from './sync/engine.ts';
import { runWorkflows } from './workflows/rules.ts';
import type { SalesforceConnector } from './connectors/salesforce.ts';

export async function runCycle(conn: Connectors, trigger: SyncRun['trigger']) {
  const run = await runSync(conn, trigger);

  let actions = 0;
  try {
    const results = await runWorkflows(conn.sf);
    actions = results.length;
    // Deal Reviews opened by a rule live in Salesforce; push them to SugarCRM right away
    if (results.some((r) => r.rule === 'deal-review')) await runSync(conn, trigger, ['dealReviews']);
  } catch (err) {
    console.error('Workflow rules failed:', (err as Error).message);
  }
  await col.syncRuns().updateOne({ _id: run._id }, { $set: { workflowActions: actions } });

  try {
    await snapshotPipeline(conn.sf);
  } catch (err) {
    console.error('Pipeline snapshot failed:', (err as Error).message);
  }

  return { ...run, workflowActions: actions };
}

export async function getPipeline(sf: SalesforceConnector) {
  const rows = await sf.query<any>(
    `SELECT StageName stage, COUNT(Id) cnt, SUM(Amount) amount FROM Opportunity GROUP BY StageName`,
  );
  const byStage = rows.map((r) => ({ stage: r.stage, count: r.cnt, amount: r.amount ?? 0 }));
  const won = byStage.find((s) => s.stage === 'Closed Won') ?? { count: 0, amount: 0 };
  const lost = byStage.find((s) => s.stage === 'Closed Lost') ?? { count: 0, amount: 0 };
  const open = byStage.filter((s) => s.stage !== 'Closed Won' && s.stage !== 'Closed Lost');
  return {
    byStage,
    openAmount: open.reduce((sum, s) => sum + s.amount, 0),
    openCount: open.reduce((sum, s) => sum + s.count, 0),
    wonAmount: won.amount,
    winRate: won.count + lost.count ? won.count / (won.count + lost.count) : 0,
  };
}

async function snapshotPipeline(sf: SalesforceConnector) {
  const p = await getPipeline(sf);
  await col.pipelineSnapshots().insertOne({
    at: new Date(),
    byStage: p.byStage,
    openAmount: p.openAmount,
    wonAmount: p.wonAmount,
    winRate: p.winRate,
  });
}
