import { z } from 'zod';

/** The common normalised shape every adapter must emit. */
export const NormalisedEvent = z.object({
  eventId: z.string().min(1),
  source: z.string().min(1),
  sourceVersion: z.string().nullable().default(null),
  sessionId: z.string().min(1),
  turnId: z.string().nullable().default(null),
  timestamp: z.string().min(1),
  workingDirectory: z.string().nullable().default(null),
  detectedProjectRoot: z.string().nullable().default(null),
  provider: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  modelAlias: z.string().nullable().default(null),
  inputTokens: z.number().int().nonnegative().nullable().default(null),
  outputTokens: z.number().int().nonnegative().nullable().default(null),
  cacheReadTokens: z.number().int().nonnegative().nullable().default(null),
  cacheWriteTokens: z.number().int().nonnegative().nullable().default(null),
  reasoningTokens: z.number().int().nonnegative().nullable().default(null),
  totalTokens: z.number().int().nonnegative().default(0),
  reportedCostUsd: z.number().nullable().default(null),
  requestType: z.string().nullable().default(null),
  status: z.string().default('ok'),
  durationMs: z.number().int().nonnegative().nullable().default(null),
  promptPreview: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).nullable().default(null),
  sourceFile: z.string().nullable().default(null),
  sourceLine: z.number().int().nullable().default(null),
});

export type NormalisedEvent = z.infer<typeof NormalisedEvent>;

/** Which normalised fields a source can actually populate. Drives the
 *  completeness percentage shown on the Data Sources page — we report what a
 *  format genuinely contains rather than implying full coverage. */
export const ALL_FIELDS = [
  'sessionId',
  'turnId',
  'timestamp',
  'workingDirectory',
  'provider',
  'model',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
  'reportedCostUsd',
  'requestType',
  'status',
  'durationMs',
  'promptPreview',
] as const;

export type FieldName = (typeof ALL_FIELDS)[number];

export interface DetectResult {
  available: boolean;
  rootPath: string | null;
  /** 'verified' only when a real local file matched the expected structure. */
  status: 'verified' | 'detected-unverified' | 'absent' | 'unsupported';
  reason?: string;
  fileCount?: number;
}

export interface PreviewResult {
  sampleEvents: NormalisedEvent[];
  filesSeen: number;
  fields: FieldName[];
}

export interface ScanContext {
  /** Returns stored checkpoint for a file, or null. */
  getCheckpoint(filePath: string): FileCheckpoint | null;
  saveCheckpoint(cp: FileCheckpoint): void;
  /** Called per batch. Return false to request cancellation. */
  onBatch(events: NormalisedEvent[]): boolean;
  onWarning(msg: string): void;
  onError(msg: string): void;
  promptPolicy: PromptPolicy;
  signal?: { cancelled: boolean };
}

export type PromptPolicy = 'none' | 'preview' | 'full';

export interface FileCheckpoint {
  source: string;
  filePath: string;
  byteOffset: number;
  mtimeMs: number;
  sizeBytes: number;
  contentHash: string | null;
  lastLine: number;
}

export interface ScanResult {
  filesScanned: number;
  recordsAdded: number;
  recordsSkipped: number;
  errors: string[];
  warnings: string[];
  cancelled: boolean;
}

export interface CompletenessReport {
  fields: FieldName[];
  missing: FieldName[];
  percentage: number;
  caveats: string[];
}

export interface SourceAdapter {
  id: string;
  name: string;
  /** Human-readable description of what was verified about this format. */
  verifiedNote: string;
  detect(): Promise<DetectResult>;
  preview(limit?: number): Promise<PreviewResult>;
  scan(ctx: ScanContext): Promise<ScanResult>;
  reportCompleteness(): CompletenessReport;
}

export function completeness(fields: FieldName[], caveats: string[] = []): CompletenessReport {
  const set = new Set(fields);
  const missing = ALL_FIELDS.filter((f) => !set.has(f));
  return {
    fields,
    missing,
    percentage: Math.round((fields.length / ALL_FIELDS.length) * 100),
    caveats,
  };
}
