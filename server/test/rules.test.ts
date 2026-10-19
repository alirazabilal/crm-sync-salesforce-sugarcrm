import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead } from '../src/workflows/rules.ts';
import { winnerOf } from '../src/sync/engine.ts';

test('decision maker from the web with full contact details is a hot lead', () => {
  const { score } = scoreLead({
    Email: 'a@b.com',
    Phone: '123',
    Title: 'VP of Operations',
    LeadSource: 'Web',
    Company: 'Indus Retail',
  });
  assert.equal(score, 75);
});

test('a lead with little information scores low', () => {
  const { score, reasons } = scoreLead({ Company: '[Not Provided]', Title: 'Analyst' });
  assert.equal(score, 0);
  assert.deepEqual(reasons, []);
});

test('score is capped at 100', () => {
  const { score } = scoreLead({ Email: 'x', Phone: 'y', Title: 'CEO', LeadSource: 'Web', Rating: 'Hot', Company: 'Z' });
  assert.equal(score, 100);
});

const rec = (iso: string) => ({ id: 'x', modifiedAt: new Date(iso), fields: {} });

test('conflict resolution: the most recent edit wins', () => {
  assert.equal(winnerOf({ sugar: rec('2026-10-03T10:00:05Z'), sf: rec('2026-10-03T10:00:00Z') }), 'sugar');
  assert.equal(winnerOf({ sugar: rec('2026-10-03T10:00:00Z'), sf: rec('2026-10-03T10:00:05Z') }), 'sf');
});

test('conflict resolution: a tie goes to Salesforce', () => {
  assert.equal(winnerOf({ sugar: rec('2026-10-03T10:00:00Z'), sf: rec('2026-10-03T10:00:00Z') }), 'sf');
});

test('a change on one side only is pushed from that side', () => {
  assert.equal(winnerOf({ sugar: rec('2026-10-03T10:00:00Z') }), 'sugar');
  assert.equal(winnerOf({ sf: rec('2026-10-03T10:00:00Z') }), 'sf');
});
