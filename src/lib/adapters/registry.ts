import type { SourceAdapter } from './types';
import { claudeCodeAdapter } from './claude-code';
import { codexAdapter } from './codex';
import { geminiAdapter } from './gemini';
import { genericJsonlAdapter, genericCsvAdapter } from './generic';

/** Only formats verified against real local files are registered here. */
export const ADAPTERS: SourceAdapter[] = [
  claudeCodeAdapter,
  codexAdapter,
  geminiAdapter,
  genericJsonlAdapter,
  genericCsvAdapter,
];

export function getAdapter(id: string): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

/**
 * Formats deliberately NOT implemented, with the reason. Surfaced in the UI so
 * an absent adapter is an explained decision rather than a silent gap.
 */
export const UNSUPPORTED_SOURCES = [
  {
    id: 'cursor',
    name: 'Cursor',
    reason:
      'Local Cursor state was inspected and contains no per-request token accounting; usage is only visible in the vendor dashboard.',
  },
  {
    id: 'anthropic-usage-export',
    name: 'Anthropic console usage export',
    reason:
      'No export file was available locally to verify the column layout. Use the Generic CSV importer and map the columns manually.',
  },
  {
    id: 'openai-usage-export',
    name: 'OpenAI usage export',
    reason:
      'No export file was available locally to verify the column layout. Use the Generic CSV importer and map the columns manually.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter usage export',
    reason:
      'No local OpenRouter export was present to verify against. Use the Generic CSV importer.',
  },
] as const;
