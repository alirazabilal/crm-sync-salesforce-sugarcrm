# CRM Sync Hub: SugarCRM + Salesforce

A CRM integration layer that keeps **Leads, Accounts, Opportunities and a custom Deal Reviews module** in sync between SugarCRM and Salesforce in both directions. It's built with Node.js, REST APIs and MongoDB, and adds workflow automation and a pipeline dashboard on top.

```
 SugarCRM (SuiteCRM 8, Docker)                         Salesforce Developer Org
 REST v4_1 API  <────────┐                    ┌────────>  REST + Tooling + Metadata API
                         │                    │           OAuth 2.0 client credentials
                  ┌──────┴────────────────────┴──────┐
                  │         Node.js Sync Hub          │
                  │  connectors -> mapping -> engine  │
                  │  workflow rules · REST API · cron │
                  └──────┬────────────────────┬──────┘
                         │                    │
                     MongoDB              React dashboard
       (id map, checkpoints, audit log,    (pipeline, sync health,
        conflicts, retry queue)             linked records, automation)
```

## What it does

| Feature | How |
|---|---|
| **Two-way sync** | Accounts, Leads, Opportunities and Deal Reviews, changes flow both ways |
| **Incremental** | Each run only pulls records changed since the last checkpoint (`date_modified` / `LastModifiedDate`) |
| **No duplicates** | ID map in MongoDB; on first sync records are matched by natural key (account name, lead email); Salesforce writes use an external-ID **upsert** on `Sugar_Id__c` so a retry can never create a second copy |
| **No ping-pong** | A content hash of each side is stored after every write; a "change" whose hash matches is our own echo and is skipped |
| **Conflict handling** | Edited in both CRMs between two runs: the most recent edit wins (ties go to Salesforce) and the conflict is logged |
| **Field mapping** | One config file maps fields and translates picklists (stages, lead status, account type, countries) |
| **Relationships** | Opportunity -> Account and Deal Review -> Opportunity are resolved through the ID map; accounts sync first |
| **Reliability** | Retries with exponential backoff on 429/5xx, token refresh on 401, per-record error isolation, dead-letter queue retried on later runs |
| **Custom modules** | `Deal_Review__c` custom object in Salesforce + `DealReviews` custom module in SugarCRM, both created by setup scripts |
| **Workflow automation** | Hot-lead scoring, Closed Won kickoff task, deal-at-risk alerts, auto Deal Review for $100k+ late-stage deals |
| **Dashboard** | Pipeline by stage, win rate, pipeline trend, hot leads, sync runs, audit log, conflicts, linked-record browser |

## Tech stack

- **Node.js 24 + TypeScript** (runs `.ts` directly, no build step), Express 5, node-cron
- **MongoDB 7** (official driver)
- **SugarCRM side:** SuiteCRM 8.8 in Docker, which serves SugarCRM's REST v4_1 API (reports itself as SugarCRM CE 6.5.25)
- **Salesforce side:** Developer Edition org, REST API, Tooling API, Metadata API (SOAP), OAuth 2.0 client credentials
- **Dashboard:** React 19, Vite, Recharts
- **Tests:** Node's built-in test runner (unit) + an end-to-end script against the real systems

## Project layout

```
docker-compose.yml        SuiteCRM + MariaDB + MongoDB
.env.example              settings template (copy to .env)
server/
  src/
    connectors/           sugar.ts, salesforce.ts (same CrmConnector interface)
    mapping/              fieldMaps.ts (all field/picklist mapping), transform.ts, addressValues.ts
    sync/engine.ts        the sync algorithm
    workflows/rules.ts    automation rules + lead scoring
    cycle.ts              sync -> workflows -> pipeline snapshot
    api.ts, index.ts      REST API, scheduler, serves the dashboard
    db.ts                 MongoDB collections
  scripts/                setup-salesforce, setup-suitecrm, seed, run-sync, check, verify-e2e
  test/                   unit tests
suitecrm/DealReviews/     the SugarCRM custom module (vardefs, views, language, registration)
dashboard/                React dashboard
docs/INTERVIEW.md         pitch, design decisions, likely questions
```

## Run it

Prerequisites: Docker Desktop, Node.js 22.18+ and a free Salesforce Developer Edition org with an External Client App that has the client credentials flow enabled.

```bash
cp .env.example .env          # then fill in the Salesforce values
docker compose up -d          # first start installs SuiteCRM (about 2 minutes)
cd server && npm install
npm run check                 # all three systems should say OK
npm run setup:salesforce      # Sugar_Id__c fields, Deal_Review__c object, permissions
npm run setup:suitecrm        # installs the DealReviews custom module
npm run seed                  # demo data in SugarCRM
npm run sync                  # first full sync
cd ../dashboard && npm install && npm run build
cd ../server && npm start     # http://localhost:3000
```

| URL | What |
|---|---|
| http://localhost:3000 | Sync hub dashboard |
| http://localhost:8081 | SuiteCRM (SugarCRM side), user `admin`, password from `.env` |
| your Salesforce org | Salesforce side |

The server runs a sync every 5 minutes (`SYNC_CRON`). The dashboard's **Sync now** button runs one immediately.

## Tests

```bash
cd server
npm test          # 16 unit tests: mapping, hashing, picklists, conflict rule, lead scoring
npm run verify    # end-to-end against the real CRMs (creates and cleans up its own test records)
npm run typecheck
```

`npm run verify` checks, against the live systems:
1. A lead created in SugarCRM appears in Salesforce, with picklist and country translated
2. An account + opportunity created in Salesforce appear in SugarCRM, linked to each other
3. An edit in SugarCRM updates Salesforce
4. The same record edited in both CRMs: the newest edit wins and a conflict is logged
5. Moving a deal to Closed Won creates the kickoff task
6. A sync with no changes writes nothing (no ping-pong)

## Demo script (3 minutes)

1. **Architecture** (30s): the diagram above. Two connectors behind one interface, a generic engine, and MongoDB as the integration's memory.
2. **Sugar to Salesforce:** create a lead in SuiteCRM (Leads, Create) with title "VP Sales", an email and lead source "Web Site". Click **Sync now**. It appears in Salesforce, scores 70+, and gets a "call within 24h" task.
3. **Salesforce to Sugar:** move an opportunity to *Negotiation/Review* with an amount over $100k. Sync. A Deal Review opens in Salesforce and shows up in SuiteCRM under Deal Reviews.
4. **Conflict:** change the same account's phone in both CRMs, then sync. Show the *Sync log* tab: conflict resolved, newest edit kept.
5. **Dashboard:** pipeline by stage, win rate, linked records with links into both CRMs.

## Things I hit and solved

- **Salesforce State & Country Picklists** rejected "USA" and "UAE". The mapping layer now normalizes countries and US state codes.
- **Silent data changes on save:** stamping `Sugar_Id__c` on old Salesforce sample records made Salesforce convert their legacy addresses, so the record changed after I had hashed it. The fix was to always hash what the target actually stored after the write, and pass any normalized values back.
- **PHP 8 named arguments:** SuiteCRM's v4_1 REST endpoint crashes if arguments are sent as a JSON object, so the connector sends them as an ordered array.
- **Converted leads are read-only in Salesforce**, so they are filtered out, and a Sugar "Converted" status never overwrites the Salesforce status.
- The Bitnami SuiteCRM image wrote a broken site URL (`localhost:8081:8080`). The setup script fixes it.

## Limits and next steps

- Deletes are not propagated (a deleted record stays in the other CRM). Next step: soft-delete detection on both sides.
- Polling every 5 minutes. Next step: Salesforce Change Data Capture or Platform Events for near-real-time sync.
- Conflict resolution is record-level. Next step: field-level merge (keep the newer value per field).
- A licensed SugarCRM (REST v11, OAuth2) needs one new connector class. Nothing else changes.
