// Workflow automation. Runs after every sync against Salesforce (the sales team's system of record).
// Each rule is idempotent: the workflowEvents collection remembers what already fired,
// so running the rules again never creates duplicate tasks.

import { config } from '../config.ts';
import { col } from '../db.ts';
import type { SalesforceConnector } from '../connectors/salesforce.ts';

/** Safety cap so a first run on a big org cannot flood it with tasks. */
const MAX_ACTIONS_PER_RUN = 50;

export interface LeadLike {
  Email?: string | null;
  Phone?: string | null;
  MobilePhone?: string | null;
  Title?: string | null;
  LeadSource?: string | null;
  Rating?: string | null;
  Company?: string | null;
  Industry?: string | null;
}

/** Simple, explainable lead score from 0 to 100. */
export function scoreLead(lead: LeadLike): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(`+${points} ${reason}`);
  };

  if (lead.Email) add(15, 'has email');
  if (lead.Phone || lead.MobilePhone) add(10, 'has phone');
  const title = (lead.Title ?? '').toLowerCase();
  if (/\b(ceo|cto|cfo|coo|cio|chief|founder|owner|president|vp|vice president|director|head)\b/.test(title)) {
    add(25, 'decision-maker title');
  } else if (/\bmanager\b/.test(title)) add(10, 'manager title');
  if (['Web', 'Partner Referral'].includes(lead.LeadSource ?? '')) add(15, `high-intent source (${lead.LeadSource})`);
  if (lead.Rating === 'Hot') add(25, 'rated Hot');
  else if (lead.Rating === 'Warm') add(10, 'rated Warm');
  if (lead.Company && lead.Company !== '[Not Provided]') add(10, 'company known');

  return { score: Math.min(score, 100), reasons };
}

export interface WorkflowResult {
  rule: string;
  recordId: string;
  recordName?: string;
  detail: string;
}

export async function runWorkflows(sf: SalesforceConnector): Promise<WorkflowResult[]> {
  const results: WorkflowResult[] = [];
  let budget = MAX_ACTIONS_PER_RUN;

  /** Run `action` once per key. Returns false when it already ran or the budget is used up. */
  async function once(rule: string, key: string, recordId: string, recordName: string, detail: string, action: () => Promise<string | undefined>) {
    const _id = `${rule}:${key}`;
    if (budget <= 0 || (await col.workflowEvents().findOne({ _id }))) return;
    budget--;
    const taskId = await action();
    await col.workflowEvents().insertOne({ _id, rule, recordId, recordName, at: new Date(), detail, taskId });
    results.push({ rule, recordId, recordName, detail });
  }

  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  // Rule 1: hot leads get a call task within 24 hours
  const leads = await sf.query<any>(
    `SELECT Id, FirstName, LastName, Email, Phone, MobilePhone, Title, LeadSource, Rating, Company, Industry
     FROM Lead WHERE IsConverted = false AND Status != 'Closed - Not Converted'`,
  );
  for (const lead of leads) {
    const { score, reasons } = scoreLead(lead);
    if (score < config.workflows.hotLeadScore) continue;
    const name = [lead.FirstName, lead.LastName].filter(Boolean).join(' ');
    await once('hot-lead', lead.Id, lead.Id, name, `Lead score ${score}: call within 24h`, () =>
      createTask(sf, {
        Subject: `Call hot lead: ${name} (score ${score})`,
        WhoId: lead.Id,
        ActivityDate: tomorrow,
        Priority: 'High',
        Description: `Created by CRM Sync Hub.\nScore breakdown:\n${reasons.join('\n')}`,
      }),
    );
  }

  // Rule 2: closed-won deals get an onboarding kickoff task
  const won = await sf.query<any>(`SELECT Id, Name, Amount FROM Opportunity WHERE StageName = 'Closed Won'`);
  for (const opp of won) {
    await once('closed-won-kickoff', opp.Id, opp.Id, opp.Name, 'Deal won: onboarding kickoff task created', () =>
      createTask(sf, {
        Subject: `Kick off onboarding: ${opp.Name}`,
        WhatId: opp.Id,
        ActivityDate: tomorrow,
        Priority: 'Normal',
        Description: `Created by CRM Sync Hub when the deal moved to Closed Won (amount ${opp.Amount ?? 'n/a'}).`,
      }),
    );
  }

  // Rule 3: open deals that are overdue or untouched for N days get flagged
  const staleBefore = new Date(Date.now() - config.workflows.staleDealDays * 86_400_000);
  const open = await sf.query<any>(`SELECT Id, Name, CloseDate, LastModifiedDate, StageName FROM Opportunity WHERE IsClosed = false`);
  for (const opp of open) {
    const overdue = opp.CloseDate && opp.CloseDate < today;
    const untouched = new Date(opp.LastModifiedDate) < staleBefore;
    if (!overdue && !untouched) continue;
    const why = overdue ? `close date ${opp.CloseDate} has passed` : `no updates in ${config.workflows.staleDealDays}+ days`;
    // Key includes the close date, so the rule fires again if the deal is rescheduled and slips again
    await once('stale-deal', `${opp.Id}:${opp.CloseDate}`, opp.Id, opp.Name, `At risk: ${why}`, () =>
      createTask(sf, {
        Subject: `Deal at risk: ${opp.Name}`,
        WhatId: opp.Id,
        ActivityDate: tomorrow,
        Priority: 'High',
        Description: `Created by CRM Sync Hub: ${why}. Stage: ${opp.StageName}. Update the close date or next step.`,
      }),
    );
  }

  // Rule 4: big deals in late stages need a Deal Review (custom object, synced to SugarCRM)
  const bigDeals = await sf.query<any>(
    `SELECT Id, Name, Amount FROM Opportunity
     WHERE IsClosed = false AND Amount >= 100000 AND StageName IN ('Proposal/Price Quote', 'Negotiation/Review')`,
  );
  for (const opp of bigDeals) {
    await once('deal-review', opp.Id, opp.Id, opp.Name, 'Amount 100k+ in late stage: Deal Review opened', async () => {
      const res = await sf.api<{ id: string }>('/sobjects/Deal_Review__c', {
        method: 'POST',
        body: JSON.stringify({
          Name: `Review: ${opp.Name}`.slice(0, 80),
          Opportunity__c: opp.Id,
          Review_Status__c: 'Pending',
          Risk_Level__c: opp.Amount >= 500000 ? 'High' : 'Medium',
          Reviewer_Notes__c: 'Opened automatically by CRM Sync Hub for a 100k+ deal in a late stage.',
        }),
      });
      return res.id;
    });
  }

  return results;
}

async function createTask(sf: SalesforceConnector, task: Record<string, unknown>): Promise<string> {
  const res = await sf.api<{ id: string }>('/sobjects/Task', {
    method: 'POST',
    body: JSON.stringify({ Status: 'Not Started', ...task }),
  });
  return res.id;
}
