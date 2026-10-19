// Run one sync cycle from the command line and print the results.

import { connectDb, closeDb } from '../src/db.ts';
import { runCycle } from '../src/cycle.ts';
import { SugarConnector } from '../src/connectors/sugar.ts';
import { SalesforceConnector } from '../src/connectors/salesforce.ts';

await connectDb();
const started = Date.now();
const run = await runCycle({ sugar: new SugarConnector(), sf: new SalesforceConnector() }, 'cli');

console.log(`Sync ${run.status} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (run.error) console.log('Error:', run.error);
console.table(run.stats);
console.log(`Workflow actions: ${run.workflowActions}`);

await closeDb();
process.exit(run.status === 'failed' ? 1 : 0);
