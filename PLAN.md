# CRM Sync Hub: SugarCRM + Salesforce Integration (Interview-Ready Build)

> **Status: built and verified.** See [README.md](README.md) to run it and [docs/INTERVIEW.md](docs/INTERVIEW.md) to pitch it. This file is the original plan, kept for reference.

## Context
You want a real, demo-able project behind this resume line:
> CRM integration layer syncing leads, accounts, and opportunities between SugarCRM and Salesforce via REST APIs, Node.js, and MongoDB, with custom modules, workflow automation, and dashboards for pipeline tracking.

Goal: build it end to end so you can run it live, explain every piece, and answer deep follow-up questions.

Current state: `D:\ALI\crm-2r` is empty. Your machine already has Node 24, Docker 29, and Git, so no installs are needed.

## Is it all free? Short answer: yes, with one swap

| Piece | Free option | Notes |
|---|---|---|
| Salesforce | **Developer Edition org** (free forever) | Full REST API, Connected Apps, custom objects, reports |
| SugarCRM | **SuiteCRM 8 in Docker** (free, open source) | SugarCRM has no free tier (only a 15-day sales trial). SuiteCRM is the open-source fork of SugarCRM: same modules (Leads, Accounts, Opportunities), same data model, and a REST API |
| MongoDB | Local Docker container or **Atlas M0** free cluster | |
| Node.js, React, Docker | Free | Already installed |
| Hosting a live demo (optional) | Render / Railway free tier + Atlas M0 | Optional, for a shareable link |

**Interview framing:** "The SugarCRM side runs on SuiteCRM, its open-source fork, behind a connector interface. Pointing it at a licensed SugarCRM instance means swapping one adapter (`/rest/v11` endpoints, OAuth2 password grant)." That is honest and actually shows good design.

## What I can do vs. what you must do
**I (Claude) can do ~95%:** all code, Docker setup, SuiteCRM custom module config, sync engine, workflows, dashboard, tests, seed data, README, architecture diagram, and an interview Q&A cheat sheet.

**You must do (about 15 minutes, I cannot create accounts or handle your passwords):**
1. Sign up at developer.salesforce.com for a free Developer Edition org.
2. Create a Connected App (I will give click-by-click steps) and paste the Client ID/Secret into a local `.env` file yourself.

## Architecture (what you will explain)
```
SuiteCRM (Docker) <--REST--> [ Node.js Sync Hub ] <--REST--> Salesforce Dev Org
                                   |
                                MongoDB
             (ID mappings, sync logs, change queue, pipeline snapshots)
                                   |
                         React Dashboard (pipeline, sync health)
```

**Key ideas to master for the interview**
- **ID mapping:** a Mongo `mappings` collection links a Sugar ID to a Salesforce ID per record, so updates never create duplicates.
- **Incremental sync:** poll each side by `date_modified` / `LastModifiedDate` since the last checkpoint (webhooks optional later).
- **Conflict handling:** last-write-wins by timestamp, with conflicts logged for review.
- **Field mapping layer:** a config file maps fields and picklist values (e.g. Sugar `sales_stage` to Salesforce `StageName`).
- **Dependency order:** Accounts first, then Leads and Opportunities (Opportunities need the Account ID).
- **Reliability:** retries with backoff, rate-limit awareness, idempotent upserts (Salesforce External ID field), dead-letter log.
- **Auth:** OAuth2 on both sides with token refresh.

## Build Plan (6 phases)

**Phase 1: Setup (Day 1)**
- `docker-compose.yml`: SuiteCRM + MariaDB + MongoDB.
- Node project skeleton (Express, TypeScript), `.env.example`.
- Salesforce: you create the org and Connected App; I add a `Sugar_Id__c` External ID field on Lead, Account, Opportunity.

**Phase 2: Connectors (Day 2)**
- `src/connectors/sugar.ts` and `src/connectors/salesforce.ts` sharing one interface: `list(changedSince)`, `get`, `upsert`, `delete`.
- OAuth token handling and refresh for both.

**Phase 3: Sync Engine (Days 3 and 4)**
- Field mapping config, transformers, ID mapping store in Mongo.
- Bi-directional sync for Accounts, Leads, Opportunities; scheduled job (node-cron) plus a "Sync now" API.
- Sync log and error/retry queue.

**Phase 4: Custom Modules + Workflow Automation (Day 5)**
- Custom module in SuiteCRM (e.g. "Deal Review") via Module Builder, synced to a Salesforce custom object.
- Rule engine in Node, e.g.: lead score above 70 auto-converts to Opportunity; Opportunity "Closed Won" creates a follow-up task; stale deals (no activity in 14 days) get flagged.

**Phase 5: Dashboard (Day 6)**
- React + Recharts: pipeline by stage, value by stage, win rate, sync health (success/fail counts, last run, conflicts), record mapping browser.
- Seed script that creates realistic demo data on both CRMs.

**Phase 6: Polish for Pitching (Day 7)**
- Tests (Jest) for mappers and sync logic.
- README with architecture diagram, setup steps, screenshots.
- `INTERVIEW.md`: 2-minute pitch, design decisions, tradeoffs, 20 likely questions with answers.
- Optional: deploy to Render + Atlas for a live link.

## Project structure
```
crm-2r/
  docker-compose.yml
  server/   src/{connectors, sync, mapping, workflows, api, db}
  dashboard/  (React)
  scripts/  (seed, salesforce setup)
  docs/     (architecture, INTERVIEW.md)
```

## Verification
- `docker compose up` brings SuiteCRM and MongoDB online.
- Create a Lead in SuiteCRM, run sync, confirm it appears in Salesforce (and the reverse).
- Edit the same record on both sides, confirm the conflict rule and log entry.
- Move an Opportunity to "Closed Won", confirm the workflow task fires.
- Dashboard shows matching pipeline numbers; `npm test` passes.

## Demo script (for the interview)
1. Show the architecture diagram (30 sec).
2. Create a lead in SuiteCRM live, click "Sync now", show it in Salesforce.
3. Close a deal in Salesforce, show the dashboard update and the automated task.
4. Show the sync log with a handled conflict and a retried failure.
