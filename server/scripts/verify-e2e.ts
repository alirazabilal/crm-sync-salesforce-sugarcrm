// End-to-end check against the real SugarCRM and Salesforce. Creates its own test records,
// runs real sync cycles, asserts the results, then removes the test records.
//   npm run verify

import assert from 'node:assert/strict';
import { connectDb, closeDb, col } from '../src/db.ts';
import { runCycle } from '../src/cycle.ts';
import { SugarConnector } from '../src/connectors/sugar.ts';
import { SalesforceConnector } from '../src/connectors/salesforce.ts';
import { getEntityMap } from '../src/mapping/fieldMaps.ts';

const sugar = new SugarConnector();
const sf = new SalesforceConnector();
const conn = { sugar, sf };
const accounts = getEntityMap('accounts');
const leads = getEntityMap('leads');
const opps = getEntityMap('opportunities');
const tag = `E2E ${new Date().toISOString().slice(11, 19)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cleanup: (() => Promise<unknown>)[] = [];

async function sync(label: string) {
  const run = await runCycle(conn, 'cli');
  assert.notEqual(run.status, 'failed', `${label}: sync failed ${run.error ?? ''}`);
  return run;
}

async function mappingFor(entity: string, side: 'sugarId' | 'sfId', id: string) {
  return col.mappings().findOne({ entity: entity as any, [side]: id });
}

async function step(name: string, fn: () => Promise<void>) {
  process.stdout.write(`- ${name} ... `);
  await fn();
  console.log('PASS');
}

await connectDb();
await sync('warm-up'); // start from a clean, settled state

try {
  // 1. A new lead in SugarCRM appears in Salesforce
  let sugarLeadId = '';
  await step('Sugar lead is created in Salesforce', async () => {
    sugarLeadId = await sugar.create(leads, {
      first_name: 'Test',
      last_name: tag,
      account_name: 'E2E Corp',
      email1: `e2e.${Date.now()}@example.com`,
      title: 'Director of Sales',
      status: 'New',
      lead_source: 'Web Site',
      primary_address_country: 'USA',
    });
    cleanup.push(() => sugar.update(leads, sugarLeadId, { deleted: 1 }));
    await sync('lead');
    const m = await mappingFor('leads', 'sugarId', sugarLeadId);
    assert.ok(m, 'no mapping created');
    cleanup.push(() => sf.api(`/sobjects/Lead/${m.sfId}`, { method: 'DELETE' }));
    const rec = await sf.get(leads, m.sfId);
    assert.equal(rec?.fields.LastName, tag);
    assert.equal(rec?.fields.LeadSource, 'Web', 'picklist not translated');
    assert.equal(rec?.fields.Country, 'United States', 'country not normalized');
  });

  // 2. An account + opportunity created in Salesforce appear in SugarCRM, linked
  let sfAccountId = '';
  let sfOppId = '';
  await step('Salesforce account + opportunity are created in Sugar, linked', async () => {
    sfAccountId = (await sf.api<any>('/sobjects/Account', { method: 'POST', body: JSON.stringify({ Name: `${tag} Account`, Industry: 'Technology' }) })).id;
    cleanup.push(() => sf.api(`/sobjects/Account/${sfAccountId}`, { method: 'DELETE' }));
    sfOppId = (
      await sf.api<any>('/sobjects/Opportunity', {
        method: 'POST',
        body: JSON.stringify({ Name: `${tag} Deal`, AccountId: sfAccountId, StageName: 'Qualification', CloseDate: '2027-01-15', Amount: 42000 }),
      })
    ).id;
    cleanup.push(() => sf.api(`/sobjects/Opportunity/${sfOppId}`, { method: 'DELETE' }));
    await sync('opportunity');
    const accMap = await mappingFor('accounts', 'sfId', sfAccountId);
    const oppMap = await mappingFor('opportunities', 'sfId', sfOppId);
    assert.ok(accMap && oppMap, 'mappings missing');
    cleanup.push(() => sugar.update(accounts, accMap.sugarId, { deleted: 1 }));
    cleanup.push(() => sugar.update(opps, oppMap.sugarId, { deleted: 1 }));
    const sOpp = await sugar.get(opps, oppMap.sugarId);
    assert.equal(sOpp?.fields.account_id, accMap.sugarId, 'opportunity not linked to account in Sugar');
    assert.equal(Number(sOpp?.fields.amount), 42000);
  });

  // 3. Edits in Sugar flow to Salesforce
  await step('Sugar edit updates Salesforce', async () => {
    const oppMap = (await mappingFor('opportunities', 'sfId', sfOppId))!;
    await sugar.update(opps, oppMap.sugarId, { ...(await sugar.get(opps, oppMap.sugarId))!.fields, sales_stage: 'Proposal/Price Quote', next_step: 'Send proposal' });
    await sync('edit');
    const rec = await sf.get(opps, sfOppId);
    assert.equal(rec?.fields.StageName, 'Proposal/Price Quote');
    assert.equal(rec?.fields.NextStep, 'Send proposal');
  });

  // 4. Same record edited on both sides: newest edit wins, conflict logged
  await step('Conflict: edited on both sides, newest edit wins', async () => {
    const accMap = (await mappingFor('accounts', 'sfId', sfAccountId))!;
    const before = await col.conflicts().countDocuments();
    await sugar.update(accounts, accMap.sugarId, { ...(await sugar.get(accounts, accMap.sugarId))!.fields, phone_office: '111-SUGAR' });
    await sleep(3000);
    await sf.update(accounts, sfAccountId, { Phone: '222-SALESFORCE' });
    await sync('conflict');
    assert.equal(await col.conflicts().countDocuments(), before + 1, 'conflict not logged');
    const s = await sugar.get(accounts, accMap.sugarId);
    assert.equal(s?.fields.phone_office, '222-SALESFORCE', 'newest edit (Salesforce) did not win');
  });

  // 5. Workflow: Closed Won creates an onboarding task
  await step('Workflow: Closed Won creates a kickoff task', async () => {
    await sf.update(opps, sfOppId, { StageName: 'Closed Won' });
    await sync('workflow');
    const ev = await col.workflowEvents().findOne({ _id: `closed-won-kickoff:${sfOppId}` });
    assert.ok(ev?.taskId, 'no workflow event');
    const tasks = await sf.query(`SELECT Id FROM Task WHERE Id = '${ev.taskId}'`);
    assert.equal(tasks.length, 1, 'task not found in Salesforce');
    cleanup.push(() => sf.api(`/sobjects/Task/${ev.taskId}`, { method: 'DELETE' }));
  });

  // 6. Nothing changed: a sync makes no writes (echo protection)
  await step('Idle sync makes no writes (no ping-pong)', async () => {
    await sync('settle');
    const run = await sync('idle');
    for (const s of Object.values(run.stats)) {
      assert.equal(s!.created + s!.updated + s!.matched, 0, 'idle sync wrote records');
    }
  });

  console.log('\nAll end-to-end checks passed.');
} finally {
  for (const fn of cleanup.reverse()) await fn().catch(() => {});
  // forget the test records' mappings so the dashboard stays clean
  await col.mappings().deleteMany({ name: { $regex: '^(Test )?E2E ' } });
  await closeDb();
}
