import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * All money is stored in USD. Display conversion (e.g. MYR) happens at render
 * time using a manually entered rate held in `settings`.
 *
 * `dataset` partitions every fact row into 'real' or 'sample' so that sample
 * data can never contaminate real analysis. Every query filters on it.
 */

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    path: text('path').notNull(),
    pathNorm: text('path_norm').notNull(),
    gitRoot: text('git_root'),
    remoteUrl: text('remote_url'),
    description: text('description'),
    status: text('status').notNull().default('active'),
    category: text('category'),
    currency: text('currency').notNull().default('USD'),
    startedAt: text('started_at'),
    valueMethod: text('value_method').notNull().default('manual'),
    tags: text('tags').notNull().default('[]'),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
    dataset: text('dataset').notNull().default('real'),
    createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
  },
  (t) => ({
    pathUq: uniqueIndex('projects_path_norm_dataset_uq').on(t.pathNorm, t.dataset),
    datasetIdx: index('projects_dataset_idx').on(t.dataset, t.archived),
  }),
);

/** Normalised token event. One row per priced/observed request. */
export const events = sqliteTable(
  'events',
  {
    eventId: text('event_id').primaryKey(),
    source: text('source').notNull(),
    sourceVersion: text('source_version'),
    sessionId: text('session_id').notNull(),
    turnId: text('turn_id'),
    timestamp: text('timestamp').notNull(),
    workingDirectory: text('working_directory'),
    detectedProjectRoot: text('detected_project_root'),
    projectId: text('project_id'),
    mappingMethod: text('mapping_method'),
    provider: text('provider'),
    model: text('model'),
    modelAlias: text('model_alias'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cacheReadTokens: integer('cache_read_tokens'),
    cacheWriteTokens: integer('cache_write_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    totalTokens: integer('total_tokens').notNull().default(0),
    reportedCostUsd: real('reported_cost_usd'),
    calculatedCostUsd: real('calculated_cost_usd'),
    priced: integer('priced', { mode: 'boolean' }).notNull().default(false),
    pricingId: text('pricing_id'),
    requestType: text('request_type'),
    status: text('status').notNull().default('ok'),
    durationMs: integer('duration_ms'),
    promptPreview: text('prompt_preview'),
    metadata: text('metadata'),
    sourceFile: text('source_file'),
    sourceLine: integer('source_line'),
    dataset: text('dataset').notNull().default('real'),
    importedAt: text('imported_at').notNull().default(sql`(current_timestamp)`),
  },
  (t) => ({
    tsIdx: index('events_ts_idx').on(t.dataset, t.timestamp),
    projIdx: index('events_project_idx').on(t.dataset, t.projectId, t.timestamp),
    modelIdx: index('events_model_idx').on(t.dataset, t.model),
    sourceIdx: index('events_source_idx').on(t.dataset, t.source),
    sessionIdx: index('events_session_idx').on(t.sessionId),
    unassignedIdx: index('events_unassigned_idx').on(t.dataset, t.projectId),
  }),
);

/** Per-file incremental scan checkpoints (mtime + byte offset + content hash). */
export const scanCheckpoints = sqliteTable(
  'scan_checkpoints',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    filePath: text('file_path').notNull(),
    byteOffset: integer('byte_offset').notNull().default(0),
    mtimeMs: real('mtime_ms').notNull().default(0),
    sizeBytes: integer('size_bytes').notNull().default(0),
    contentHash: text('content_hash'),
    lastLine: integer('last_line').notNull().default(0),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  },
  (t) => ({ uq: uniqueIndex('scan_ckpt_uq').on(t.source, t.filePath) }),
);

export const scanRuns = sqliteTable('scan_runs', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  status: text('status').notNull().default('running'),
  filesScanned: integer('files_scanned').notNull().default(0),
  recordsAdded: integer('records_added').notNull().default(0),
  recordsUpdated: integer('records_updated').notNull().default(0),
  recordsSkipped: integer('records_skipped').notNull().default(0),
  errorCount: integer('error_count').notNull().default(0),
  warnings: text('warnings').notNull().default('[]'),
  errors: text('errors').notNull().default('[]'),
  durationMs: integer('duration_ms').notNull().default(0),
});

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  rootPath: text('root_path'),
  status: text('status').notNull().default('detected'),
  lastScanAt: text('last_scan_at'),
  notes: text('notes'),
});

export const pricing = sqliteTable(
  'pricing',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    aliases: text('aliases').notNull().default('[]'),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    inputPerMTok: real('input_per_mtok').notNull().default(0),
    outputPerMTok: real('output_per_mtok').notNull().default(0),
    cacheReadPerMTok: real('cache_read_per_mtok').notNull().default(0),
    cacheWritePerMTok: real('cache_write_per_mtok').notNull().default(0),
    reasoningPerMTok: real('reasoning_per_mtok'),
    currency: text('currency').notNull().default('USD'),
    sourceNote: text('source_note'),
    userOverride: integer('user_override', { mode: 'boolean' }).notNull().default(false),
    updatedAt: text('updated_at').notNull().default(sql`(current_timestamp)`),
  },
  (t) => ({ modelIdx: index('pricing_model_idx').on(t.modelId, t.effectiveFrom) }),
);

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(),
  planName: text('plan_name').notNull(),
  monthlyPrice: real('monthly_price').notNull().default(0),
  currency: text('currency').notNull().default('USD'),
  billingStart: text('billing_start').notNull(),
  billingEnd: text('billing_end'),
  billingCycle: text('billing_cycle').notNull().default('monthly'),
  seats: integer('seats').notNull().default(1),
  taxPct: real('tax_pct').notNull().default(0),
  discountPct: real('discount_pct').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  allocationMethod: text('allocation_method').notNull().default('token_share'),
  allocationConfig: text('allocation_config').notNull().default('{}'),
  notes: text('notes'),
  dataset: text('dataset').notNull().default('real'),
});

export const valueEvents = sqliteTable(
  'value_events',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    valueType: text('value_type').notNull(),
    amount: real('amount').notNull(),
    currency: text('currency').notNull().default('USD'),
    date: text('date').notNull(),
    recurring: integer('recurring', { mode: 'boolean' }).notNull().default(false),
    recurrencePeriod: text('recurrence_period'),
    recurrenceEnd: text('recurrence_end'),
    realised: integer('realised', { mode: 'boolean' }).notNull().default(true),
    confidence: text('confidence').notNull().default('medium'),
    description: text('description'),
    note: text('note'),
    evidenceRef: text('evidence_ref'),
    dataset: text('dataset').notNull().default('real'),
  },
  (t) => ({ projIdx: index('value_project_idx').on(t.dataset, t.projectId, t.date) }),
);

export const gitMetrics = sqliteTable('git_metrics', {
  projectId: text('project_id').primaryKey(),
  commitCount: integer('commit_count').notNull().default(0),
  activeDays: integer('active_days').notNull().default(0),
  branches: integer('branches').notNull().default(0),
  linesAdded: integer('lines_added').notNull().default(0),
  linesRemoved: integer('lines_removed').notNull().default(0),
  filesChanged: integer('files_changed').notNull().default(0),
  contributors: integer('contributors').notNull().default(0),
  firstCommitAt: text('first_commit_at'),
  lastCommitAt: text('last_commit_at'),
  commitsByDay: text('commits_by_day').notNull().default('{}'),
  scannedAt: text('scanned_at'),
  dirty: integer('dirty', { mode: 'boolean' }).notNull().default(false),
});

/** Manual/remembered project mapping rules, applied before 'unassigned'. */
export const mappingRules = sqliteTable('mapping_rules', {
  id: text('id').primaryKey(),
  pattern: text('pattern').notNull(),
  kind: text('kind').notNull().default('prefix'),
  projectId: text('project_id').notNull(),
  createdAt: text('created_at').notNull().default(sql`(current_timestamp)`),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
