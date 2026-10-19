// Quick health check: can we reach SugarCRM (SuiteCRM), Salesforce and MongoDB?

import { SugarConnector } from '../src/connectors/sugar.ts';
import { SalesforceConnector } from '../src/connectors/salesforce.ts';
import { connectDb, closeDb } from '../src/db.ts';
import { getEntityMap } from '../src/mapping/fieldMaps.ts';

const sugar = new SugarConnector();
const sf = new SalesforceConnector();
let ok = true;

async function check(name: string, fn: () => Promise<string>) {
  try {
    console.log(`OK    ${name}: ${await fn()}`);
  } catch (err) {
    ok = false;
    console.log(`FAIL  ${name}: ${(err as Error).message}`);
  }
}

await check('SugarCRM', async () => {
  const info = await sugar.serverInfo();
  const accounts = await sugar.listChanged(getEntityMap('accounts'), new Date(0));
  return `version ${info.version ?? '?'} (${info.flavor ?? '?'}), ${accounts.length} accounts`;
});

await check('Salesforce', async () => {
  const res = await sf.api<any>('/query?q=' + encodeURIComponent('SELECT COUNT() FROM Account'));
  return `${res.totalSize} accounts, instance ${await sf.instanceUrl()}`;
});

await check('MongoDB', async () => {
  const db = await connectDb();
  const stats = await db.command({ ping: 1 });
  return stats.ok === 1 ? `connected to ${db.databaseName}` : 'ping failed';
});

await closeDb();
process.exit(ok ? 0 : 1);
