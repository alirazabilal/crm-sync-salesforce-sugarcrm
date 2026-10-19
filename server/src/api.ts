// REST API used by the dashboard.

import express, { type Request, type Response, type NextFunction } from 'express';
import { col } from './db.ts';
import { config } from './config.ts';
import { runCycle, getPipeline } from './cycle.ts';
import { isSyncRunning, type Connectors } from './sync/engine.ts';
import { scoreLead } from './workflows/rules.ts';
import { ENTITY_MAPS } from './mapping/fieldMaps.ts';

const limitOf = (req: Request, def = 50, max = 500) => Math.min(Number(req.query.limit) || def, max);

// Express 5 forwards rejected promises to the error handler, so handlers can be async
export function createApi(conn: Connectors) {
  const api = express.Router();
  api.use(express.json());

  api.get('/health', async (_req, res) => {
    const check = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return 'ok';
      } catch (err) {
        return (err as Error).message;
      }
    };
    const [sugar, salesforce] = await Promise.all([
      check(() => conn.sugar.serverInfo()),
      check(() => conn.sf.api('/limits')),
    ]);
    res.json({ sugar, salesforce, mongo: 'ok', syncRunning: isSyncRunning() });
  });

  api.get('/config', async (_req, res) => {
    res.json({
      salesforceUrl: (await conn.sf.instanceUrl()).replace('.my.salesforce.com', '.lightning.force.com'),
      sugarUrl: config.sugar.url,
      syncCron: config.syncCron,
      entities: ENTITY_MAPS.map((e) => ({ name: e.name, sugarModule: e.sugarModule, sfObject: e.sfObject, fields: e.fields.length })),
    });
  });

  api.get('/summary', async (_req, res) => {
    const [mappings, lastRun, openDeadLetters, conflicts, workflowActions] = await Promise.all([
      col.mappings().aggregate([{ $group: { _id: '$entity', count: { $sum: 1 } } }]).toArray(),
      col.syncRuns().find().sort({ startedAt: -1 }).limit(1).next(),
      col.deadLetters().countDocuments({ resolved: false }),
      col.conflicts().countDocuments(),
      col.workflowEvents().countDocuments(),
    ]);
    res.json({
      mappings: Object.fromEntries(mappings.map((m) => [m._id, m.count])),
      lastRun,
      openDeadLetters,
      conflicts,
      workflowActions,
    });
  });

  api.post('/sync', async (_req, res) => {
    if (isSyncRunning()) return res.status(409).json({ error: 'A sync is already running' });
    const run = await runCycle(conn, 'manual');
    res.json(run);
  });

  api.get('/runs', async (req, res) => {
    res.json(await col.syncRuns().find().sort({ startedAt: -1 }).limit(limitOf(req, 20)).toArray());
  });

  api.get('/events', async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.entity) filter.entity = String(req.query.entity);
    if (req.query.action) filter.action = String(req.query.action);
    res.json(await col.syncEvents().find(filter).sort({ at: -1 }).limit(limitOf(req, 100)).toArray());
  });

  api.get('/conflicts', async (req, res) => {
    res.json(await col.conflicts().find().sort({ at: -1 }).limit(limitOf(req)).toArray());
  });

  api.get('/dead-letters', async (req, res) => {
    res.json(await col.deadLetters().find({ resolved: false }).sort({ lastAttemptAt: -1 }).limit(limitOf(req)).toArray());
  });

  api.get('/mappings', async (req, res) => {
    const filter: Record<string, unknown> = {};
    if (req.query.entity) filter.entity = String(req.query.entity);
    if (req.query.q) filter.name = { $regex: escapeRegex(String(req.query.q)), $options: 'i' };
    res.json(await col.mappings().find(filter).sort({ lastSyncedAt: -1 }).limit(limitOf(req, 100)).toArray());
  });

  api.get('/workflows', async (req, res) => {
    res.json(await col.workflowEvents().find().sort({ at: -1 }).limit(limitOf(req)).toArray());
  });

  api.get('/pipeline', async (_req, res) => {
    const [current, history] = await Promise.all([
      getPipeline(conn.sf),
      col.pipelineSnapshots().find().sort({ at: -1 }).limit(30).toArray(),
    ]);
    res.json({ ...current, history: history.reverse().map((h) => ({ at: h.at, openAmount: h.openAmount, wonAmount: h.wonAmount, winRate: h.winRate })) });
  });

  api.get('/leads/hot', async (req, res) => {
    const leads = await conn.sf.query<any>(
      `SELECT Id, FirstName, LastName, Company, Title, Email, Phone, MobilePhone, LeadSource, Rating, Status
       FROM Lead WHERE IsConverted = false AND Status != 'Closed - Not Converted'`,
    );
    const scored = leads
      .map((l) => ({ id: l.Id, name: [l.FirstName, l.LastName].filter(Boolean).join(' '), company: l.Company, title: l.Title, status: l.Status, ...scoreLead(l) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limitOf(req, 10));
    res.json({ threshold: config.workflows.hotLeadScore, leads: scored });
  });

  api.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: err.message });
  });

  return api;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
