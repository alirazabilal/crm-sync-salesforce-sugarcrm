import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, hashFields, translate, MissingReferenceError } from '../src/mapping/transform.ts';
import { getEntityMap } from '../src/mapping/fieldMaps.ts';

const accounts = getEntityMap('accounts');
const leads = getEntityMap('leads');
const opps = getEntityMap('opportunities');
const noRefs = async () => null;

test('normalize treats empty values the same in both systems', () => {
  assert.equal(normalize(''), null);
  assert.equal(normalize('   '), null);
  assert.equal(normalize(undefined), null);
  assert.equal(normalize(' Acme '), 'Acme');
});

test('normalize converts numbers and dates', () => {
  assert.equal(normalize('25000.000000', 'number'), 25000);
  assert.equal(normalize('1,200', 'integer'), 1200);
  assert.equal(normalize('2026-12-01T00:00:00Z', 'date'), '2026-12-01');
  assert.equal(normalize('abc', 'number'), null);
});

test('hash is equal for the same data whatever the formatting', () => {
  const a = { name: 'Acme', annual_revenue: '5000000', employees: '120', website: '' };
  const b = { name: 'Acme ', annual_revenue: 5000000, employees: 120, website: null };
  assert.equal(hashFields(accounts, 'sugar', a), hashFields(accounts, 'sugar', b));
});

test('hash changes when a mapped field changes', () => {
  const a = { name: 'Acme', industry: 'Technology' };
  assert.notEqual(hashFields(accounts, 'sugar', a), hashFields(accounts, 'sugar', { ...a, industry: 'Banking' }));
});

test('translates picklists and normalizes countries for Salesforce', async () => {
  const out = await translate(
    accounts,
    'toSf',
    { name: 'Acme', account_type: 'Reseller', billing_address_country: 'USA', billing_address_state: 'IL', annual_revenue: '10' },
    noRefs,
  );
  assert.equal(out.Name, 'Acme');
  assert.equal(out.Type, 'Channel Partner / Reseller');
  assert.equal(out.BillingCountry, 'United States');
  assert.equal(out.BillingState, 'Illinois');
  assert.equal(out.AnnualRevenue, 10);
});

test('translates Salesforce values back to Sugar', async () => {
  const out = await translate(leads, 'toSugar', { LastName: 'Khan', Status: 'Working - Contacted', LeadSource: 'Web' }, noRefs);
  assert.equal(out.last_name, 'Khan');
  assert.equal(out.status, 'In Process');
  assert.equal(out.lead_source, 'Web Site');
});

test('fills Salesforce required fields with defaults', async () => {
  const out = await translate(leads, 'toSf', { last_name: 'Khan' }, noRefs);
  assert.equal(out.Company, '[Not Provided]');
  assert.equal(out.Status, 'Open - Not Contacted');
});

test('a converted Sugar lead does not overwrite the Salesforce status', async () => {
  const out = await translate(leads, 'toSf', { last_name: 'Khan', status: 'Converted' }, noRefs);
  assert.equal('Status' in out, false);
});

test('resolves references through the id mapping', async () => {
  const out = await translate(opps, 'toSf', { name: 'Deal', account_id: 'sugar-acc-1', amount: '5' }, async (entity, id) =>
    entity === 'accounts' && id === 'sugar-acc-1' ? '001SF' : null,
  );
  assert.equal(out.AccountId, '001SF');
});

test('throws MissingReferenceError when the account is not synced yet', async () => {
  await assert.rejects(translate(opps, 'toSf', { name: 'Deal', account_id: 'unknown' }, noRefs), MissingReferenceError);
});
