// Typed calls to the sync hub API.

export type EntityName = 'accounts' | 'leads' | 'opportunities' | 'dealReviews';

export interface EntityStats {
  created: number;
  updated: number;
  unchanged: number;
  matched: number;
  conflicts: number;
  failed: number;
  deferred: number;
}

export interface SyncRun {
  _id: string;
  trigger: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  startedAt: string;
  finishedAt?: string;
  stats: Partial<Record<EntityName, EntityStats>>;
  workflowActions?: number;
  error?: string;
}

export interface SyncEvent {
  _id: string;
  at: string;
  entity: EntityName;
  action: 'created' | 'updated' | 'matched' | 'conflict' | 'error' | 'deferred';
  direction: 'sugar->sf' | 'sf->sugar';
  sugarId?: string;
  sfId?: string;
  name?: string;
  message?: string;
}

export interface Mapping {
  _id: string;
  entity: EntityName;
  sugarId: string;
  sfId: string;
  name?: string;
  lastSyncedAt: string;
}

export interface Conflict {
  _id: string;
  at: string;
  entity: EntityName;
  name?: string;
  winner: 'sugar' | 'sf';
  sugarModifiedAt: string;
  sfModifiedAt: string;
}

export interface DeadLetter {
  _id: string;
  entity: EntityName;
  side: 'sugar' | 'sf';
  name?: string;
  error: string;
  attempts: number;
  lastAttemptAt: string;
}

export interface WorkflowEvent {
  _id: string;
  rule: string;
  recordId: string;
  recordName?: string;
  at: string;
  detail: string;
}

export interface Pipeline {
  byStage: { stage: string; count: number; amount: number }[];
  openAmount: number;
  openCount: number;
  wonAmount: number;
  winRate: number;
  history: { at: string; openAmount: number; wonAmount: number; winRate: number }[];
}

export interface Summary {
  mappings: Partial<Record<EntityName, number>>;
  lastRun: SyncRun | null;
  openDeadLetters: number;
  conflicts: number;
  workflowActions: number;
}

export interface Health {
  sugar: string;
  salesforce: string;
  mongo: string;
  syncRunning: boolean;
}

export interface AppConfig {
  salesforceUrl: string;
  sugarUrl: string;
  syncCron: string;
}

export interface HotLeads {
  threshold: number;
  leads: { id: string; name: string; company?: string; title?: string; status?: string; score: number; reasons: string[] }[];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  return res.json();
}

export const api = {
  health: () => get<Health>('/health'),
  config: () => get<AppConfig>('/config'),
  summary: () => get<Summary>('/summary'),
  pipeline: () => get<Pipeline>('/pipeline'),
  runs: () => get<SyncRun[]>('/runs?limit=15'),
  events: (q = '') => get<SyncEvent[]>(`/events?limit=200${q}`),
  conflicts: () => get<Conflict[]>('/conflicts?limit=50'),
  deadLetters: () => get<DeadLetter[]>('/dead-letters'),
  mappings: (q = '') => get<Mapping[]>(`/mappings?limit=300${q}`),
  workflows: () => get<WorkflowEvent[]>('/workflows?limit=100'),
  hotLeads: () => get<HotLeads>('/leads/hot?limit=8'),
  sync: async (): Promise<SyncRun> => {
    const res = await fetch('/api/sync', { method: 'POST' });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  },
};

export const ENTITY_LABELS: Record<EntityName, string> = {
  accounts: 'Accounts',
  leads: 'Leads',
  opportunities: 'Opportunities',
  dealReviews: 'Deal Reviews',
};

/** Salesforce object and Sugar module per entity, for building record links. */
export const ENTITY_OBJECTS: Record<EntityName, { sf: string; sugar: string }> = {
  accounts: { sf: 'Account', sugar: 'Accounts' },
  leads: { sf: 'Lead', sugar: 'Leads' },
  opportunities: { sf: 'Opportunity', sugar: 'Opportunities' },
  dealReviews: { sf: 'Deal_Review__c', sugar: 'DealReviews' },
};
