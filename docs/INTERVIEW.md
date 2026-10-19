# Interview Guide: CRM Sync Hub

## The resume line

> Built a CRM integration layer syncing leads, accounts, and opportunities between SugarCRM and Salesforce via REST APIs, Node.js, & MongoDB, with custom modules, workflow automation, and dashboards for pipeline tracking.

## 30-second pitch

"Companies that run two CRMs, usually after a merger or with one team on each tool, end up with duplicate leads and two versions of the pipeline. I built a Node.js integration layer that keeps SugarCRM and Salesforce in sync both ways: leads, accounts, opportunities, and a custom Deal Review module I built on both sides. It syncs incrementally, matches existing records so it never creates duplicates, resolves conflicts when the same record is edited in both places, and retries failures on its own. On top of that it runs workflow rules, like lead scoring and at-risk deal alerts, and a React dashboard shows the pipeline and the health of the sync."

## 2-minute walkthrough (follow the code)

1. **Connectors** (`server/src/connectors/`). One interface, `CrmConnector`, with `listChanged`, `get`, `findByNaturalKey`, `create`, `update`. The Salesforce connector uses OAuth client credentials and SOQL. The Sugar connector uses Sugar's REST v4_1 API with session login. The engine never knows which CRM it is talking to.
2. **Mapping** (`server/src/mapping/fieldMaps.ts`). Pure configuration: which field maps to which, plus picklist translation tables. Adding a field or even a new object is a config change.
3. **Engine** (`server/src/sync/engine.ts`). For each object type, in dependency order:
   pull changes from both sides since the checkpoint, drop echoes by hash, pair records (ID map or natural key), resolve conflicts, write, re-read, store hashes.
4. **MongoDB** is the integration's memory: the ID map, checkpoints, an audit log of every write, conflicts, and a dead-letter queue.
5. **Workflows** (`server/src/workflows/rules.ts`) run after each sync and are idempotent.
6. **Dashboard** reads everything through a small Express API.

## Design decisions (and why)

| Decision | Why | Trade-off |
|---|---|---|
| Polling on `LastModifiedDate` / `date_modified` | Works on any CRM with no extra setup, easy to reason about | Up to 5 minutes delay. Salesforce CDC would be real-time but needs extra setup and a fallback anyway |
| Checkpoint per object and per side, with a 2-minute overlap | Clocks on two servers are never exactly aligned, so re-reading a small window avoids missing edits | Re-reads a few records, which the hash check makes harmless |
| Content hash per side in the ID map | The only reliable way to tell "someone edited this" from "this is my own write coming back". Without it the two systems would update each other forever | One extra read after each write |
| Hash what the target stored, not what I sent | Targets change data on save (Salesforce normalized "USA" to "United States"). Hashing what I sent would make every record look edited on the next run | Same extra read |
| Most recent edit wins, ties go to Salesforce | Simple, predictable, and logged so a human can review | Record-level, not field-level. Two people editing different fields at once lose one edit |
| External-ID upsert (`Sugar_Id__c`) | If the process dies after creating a record but before saving the mapping, the retry updates the same record instead of duplicating it | Needs a custom field, created by the setup script |
| Natural-key matching on first sync | Both CRMs already have data. Matching by account name or lead email links them instead of doubling everything | Name matching can mismatch; in production I would add a manual review queue for fuzzy matches |
| Dead-letter queue, max 5 attempts | One bad record must not block the other 500. It gets retried, and the reason is visible on the dashboard | Needs monitoring |
| Accounts sync before opportunities | An opportunity needs its account's ID on the other side. If the account failed, the opportunity is "deferred" and retried | Strict ordering per object type |
| Salesforce is the system for automation | Tasks and rules live where the sales team works | Rules would need porting if the company moved off Salesforce |
| SuiteCRM instead of licensed SugarCRM | SugarCRM has no free tier. SuiteCRM is its open-source fork and serves the same REST v4_1 API (it even reports itself as SugarCRM CE 6.5) | A SugarCRM 7+ instance (REST v11) needs one more connector class |

## Problems I actually hit (great interview stories)

1. **The ping-pong bug.** On my second sync, 29 records "updated" even though nobody touched them. I traced it to Salesforce changing records after my write: stamping the link field made Salesforce re-save old sample records and convert their addresses to picklist values. My stored hash no longer matched. The fix was to always re-read and hash the stored version, then push the normalized values back to Sugar. After that, an idle sync makes zero writes, and that is now an automated end-to-end check.
2. **Country picklists.** Salesforce rejected "USA" because the org has State and Country Picklists on. I added a normalization table in the mapping layer, which is the right place for data-quality rules.
3. **PHP 8 broke the Sugar API.** The REST endpoint crashed with "Unknown named parameter $session". PHP 8 treats associative arrays as named arguments, so I changed the connector to send positional arrays.
4. **Converted leads are read-only** in Salesforce, so updates to them fail. They are filtered out of the sync query.

## Likely questions and answers

**How do you avoid infinite update loops?**
Every mapping stores a hash of the mapped fields on both sides, taken after the write. When a record shows up as changed, I hash it and compare. If it matches, it's our own write coming back, so it's skipped.

**What happens if the same record is edited in both systems?**
Both changes appear in the same run, linked by the ID map. I compare modification timestamps, push the newer version, and write the conflict to MongoDB. The dashboard lists it. Field-level merge is the next step.

**How do you prevent duplicates?**
Three layers: the ID map, natural-key matching on the first sync, and an external-ID upsert into Salesforce so even a crash mid-write can't create a second record.

**Why MongoDB?**
The documents are naturally shaped: mapping documents, run summaries with nested stats per object, and audit events. No joins are needed, and unique compound indexes (`entity + sugarId`, `entity + sfId`) enforce one mapping per record.

**How do you handle API limits?**
Incremental sync keeps calls low. Writes run 5 at a time per object, with retries and exponential backoff on 429 and 5xx (honoring `Retry-After`). For big volumes I would switch the initial load to the Salesforce Bulk API 2.0.

**How do you authenticate?**
Salesforce: OAuth 2.0 client credentials through an External Client App, with a dedicated "Run As" user and a permission set. Tokens are cached and refreshed on a 401. Sugar: session login, re-login when the session expires. Secrets live in `.env`, never in code or git.

**What if Salesforce is down?**
Each record write is isolated. Failures go to the dead-letter queue and are retried on the next run. Checkpoints still advance, because failed records are retried by ID, not by time window.

**How would you scale this to a million records?**
Bulk API 2.0 for the initial load, a queue (BullMQ or SQS) with worker processes per object type, Change Data Capture instead of polling, and partitioned checkpoints.

**How do you test an integration like this?**
Unit tests for the pure parts (mapping, hashing, conflict rule, scoring) and an end-to-end script that creates real records in both CRMs, runs real syncs, asserts the results, and cleans up.

**Why not use an off-the-shelf iPaaS (MuleSoft, Zapier, Workato)?**
For a production team, often a good choice. Building it myself let me control the conflict rules, echo detection and custom-object mapping, and show I understand what those tools do internally.

**What would you add next?**
Delete propagation, field-level merge, Change Data Capture, a manual review screen for conflicts and fuzzy matches, and alerting when the dead-letter queue grows.

**What is the custom module?**
A Deal Review: a discount and risk approval attached to an opportunity. In Salesforce it's a custom object (`Deal_Review__c`) with a lookup, picklists and a percent field, created through the Tooling and Metadata APIs. In SugarCRM it's a custom module with its own vardefs, list/edit/detail views and language files. A workflow rule opens one automatically for $100k+ deals in late stages, and it syncs like any other object.

**How is lead scoring done?**
A transparent points model: email +15, phone +10, decision-maker title +25, high-intent source +15, rating Hot +25, known company +10, capped at 100. At 70 or more, a high-priority call task is created with the score breakdown in the description. Being explainable mattered more than being clever.

## Numbers you can quote

- 4 object types synced both ways, about 50 field mappings
- About 95 linked records after the first sync of the demo data
- An idle sync finishes in about 7 seconds and makes zero writes
- 16 unit tests plus 6 end-to-end scenarios against the live systems
- 4 automation rules, all idempotent
