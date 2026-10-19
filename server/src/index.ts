// CRM Sync Hub server: REST API + scheduled sync + the built dashboard.

import express from 'express';
import cron from 'node-cron';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.ts';
import { connectDb } from './db.ts';
import { createApi } from './api.ts';
import { runCycle } from './cycle.ts';
import { isSyncRunning } from './sync/engine.ts';
import { SugarConnector } from './connectors/sugar.ts';
import { SalesforceConnector } from './connectors/salesforce.ts';

const conn = { sugar: new SugarConnector(), sf: new SalesforceConnector() };

await connectDb();

const app = express();
app.use('/api', createApi(conn));

// Serve the React dashboard build if it exists (npm run build in /dashboard)
const dashboardDir = fileURLToPath(new URL('../../dashboard/dist', import.meta.url));
if (existsSync(dashboardDir)) {
  app.use(express.static(dashboardDir));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(`${dashboardDir}/index.html`));
}

app.listen(config.port, () => {
  console.log(`CRM Sync Hub running on http://localhost:${config.port}`);
});

cron.schedule(config.syncCron, async () => {
  if (isSyncRunning()) return;
  try {
    const run = await runCycle(conn, 'schedule');
    console.log(`[${new Date().toISOString()}] scheduled sync ${run.status}`);
  } catch (err) {
    console.error('Scheduled sync failed:', (err as Error).message);
  }
});
console.log(`Scheduled sync: "${config.syncCron}"`);
