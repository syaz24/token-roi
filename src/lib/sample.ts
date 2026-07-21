import { randomUUID } from 'node:crypto';
import { raw } from '@/db/client';
import { PricingRegistry, type PriceRow } from './pricing/engine';

/**
 * Sample dataset for development and screenshots.
 *
 * Everything written here carries dataset='sample'. Real rows are never
 * touched, and every query filters on dataset, so the two can never mix.
 * The UI shows a SAMPLE DATA badge whenever this dataset is selected.
 */

const SAMPLE_PROJECTS = [
  { name: 'Atlas Ledger', path: 'C:/sample/atlas-ledger', category: 'SaaS', roi: 'high' },
  { name: 'Kestrel Analytics', path: 'C:/sample/kestrel-analytics', category: 'SaaS', roi: 'medium' },
  { name: 'Marina Booking', path: 'C:/sample/marina-booking', category: 'Client work', roi: 'low' },
  { name: 'Beacon Docs', path: 'C:/sample/beacon-docs', category: 'Internal', roi: 'none' },
  { name: 'Orchard Scraper', path: 'C:/sample/orchard-scraper', category: 'Experiment', roi: 'negative' },
];

const SAMPLE_MODELS = [
  { model: 'claude-opus-4-8', provider: 'anthropic', source: 'claude-code', weight: 0.28 },
  { model: 'claude-sonnet-5', provider: 'anthropic', source: 'claude-code', weight: 0.34 },
  { model: 'gpt-5.5', provider: 'openai', source: 'codex', weight: 0.18 },
  { model: 'gemini-3-flash-preview', provider: 'google', source: 'gemini-cli', weight: 0.12 },
  // Deliberately unpriced, to exercise the coverage warnings.
  { model: 'internal-preview-model-x', provider: 'unknown', source: 'generic-jsonl', weight: 0.08 },
];

/** Deterministic PRNG so sample data is stable across reinstalls. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function removeSampleData(): void {
  const d = raw();
  const tx = d.transaction(() => {
    d.prepare(`DELETE FROM events WHERE dataset = 'sample'`).run();
    d.prepare(`DELETE FROM projects WHERE dataset = 'sample'`).run();
    d.prepare(`DELETE FROM value_events WHERE dataset = 'sample'`).run();
    d.prepare(`DELETE FROM subscriptions WHERE dataset = 'sample'`).run();
  });
  tx();
}

export function installSampleData(): number {
  removeSampleData();
  const d = raw();
  const rand = rng(20260721);

  const priceRows = (
    d
      .prepare(
        `SELECT id, provider, model_id, aliases, effective_from, effective_to, input_per_mtok,
                output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, reasoning_per_mtok, user_override
           FROM pricing`,
      )
      .all() as any[]
  ).map<PriceRow>((r) => ({
    id: r.id,
    provider: r.provider,
    modelId: r.model_id,
    aliases: safeArr(r.aliases),
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    inputPerMTok: r.input_per_mtok,
    outputPerMTok: r.output_per_mtok,
    cacheReadPerMTok: r.cache_read_per_mtok,
    cacheWritePerMTok: r.cache_write_per_mtok,
    reasoningPerMTok: r.reasoning_per_mtok,
    userOverride: !!r.user_override,
  }));
  const pricing = new PricingRegistry(priceRows);

  const projectIds: Record<string, string> = {};
  const insProject = d.prepare(
    `INSERT INTO projects (id, name, path, path_norm, git_root, description, status, category,
       currency, started_at, value_method, tags, archived, dataset, created_at)
     VALUES (?,?,?,?,?,?,'active',?, 'USD', ?, 'manual', '[]', 0, 'sample', ?)`,
  );

  const insEvent = d.prepare(
    `INSERT OR IGNORE INTO events (event_id, source, session_id, timestamp, working_directory,
       project_id, mapping_method, provider, model, model_alias, input_tokens, output_tokens,
       cache_read_tokens, cache_write_tokens, reasoning_tokens, total_tokens, calculated_cost_usd,
       priced, pricing_id, request_type, status, duration_ms, prompt_preview, metadata,
       source_file, source_line, dataset, imported_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'message',?,?,?,?,?,?,'sample',?)`,
  );

  const insValue = d.prepare(
    `INSERT INTO value_events (id, project_id, value_type, amount, currency, date, recurring,
       recurrence_period, recurrence_end, realised, confidence, description, dataset)
     VALUES (?,?,?,?,'USD',?,?,?,NULL,?,?,?,'sample')`,
  );

  const insSub = d.prepare(
    `INSERT INTO subscriptions (id, provider, plan_name, monthly_price, currency, billing_start,
       billing_cycle, seats, tax_pct, discount_pct, active, allocation_method, allocation_config, notes, dataset)
     VALUES (?,?,?,?, 'USD', ?, 'monthly', 1, 0, 0, 1, ?, '{}', ?, 'sample')`,
  );

  const now = Date.now();
  const DAYS = 120;
  let eventCount = 0;

  const tx = d.transaction(() => {
    for (const p of SAMPLE_PROJECTS) {
      const id = randomUUID();
      projectIds[p.name] = id;
      insProject.run(
        id,
        p.name,
        p.path,
        p.path.toLowerCase(),
        p.path,
        `Sample project for demonstration (${p.category}).`,
        p.category,
        new Date(now - DAYS * 86_400_000).toISOString(),
        new Date().toISOString(),
      );
    }

    for (let day = DAYS; day >= 0; day--) {
      const dayStart = now - day * 86_400_000;
      for (const p of SAMPLE_PROJECTS) {
        // Activity ramps differently per project so charts have real shape.
        const intensity =
          p.roi === 'high' ? 0.9 : p.roi === 'medium' ? 0.6 : p.roi === 'low' ? 0.4 : p.roi === 'none' ? 0.25 : 0.7;
        const requests = Math.floor(rand() * 8 * intensity);
        if (!requests) continue;
        const sessionId = `sample-${projectIds[p.name].slice(0, 8)}-${day}`;

        for (let i = 0; i < requests; i++) {
          const m = pickModel(rand());
          const ts = new Date(dayStart + Math.floor(rand() * 86_400_000)).toISOString();
          // Magnitudes chosen so sample costs land in the hundreds-to-thousands
          // of dollars, which is what real agentic coding sessions produce and
          // what makes the ROI spread (high / low / negative) meaningful.
          const scale = 40;
          const input = Math.floor((500 + rand() * 12_000) * scale);
          const output = Math.floor((200 + rand() * 3_000) * scale);
          const cacheRead = Math.floor(rand() * (m.source === 'claude-code' ? 40_000 : 8_000) * scale);
          const cacheWrite = m.source === 'claude-code' ? Math.floor(rand() * 12_000 * scale) : 0;
          // Some records deliberately lack reasoning tokens, mirroring reality.
          const reasoning = m.source === 'codex' || m.source === 'gemini-cli' ? Math.floor(rand() * 900) : null;
          const total = input + output + cacheRead + cacheWrite;

          const cost = pricing.cost(m.model, ts, {
            inputTokens: input,
            outputTokens: output,
            cacheReadTokens: cacheRead,
            cacheWriteTokens: cacheWrite,
            reasoningTokens: reasoning,
          });

          // ~4% of sample sessions are intentionally unassigned.
          const unassigned = rand() < 0.04;
          const failed = rand() < 0.03;

          insEvent.run(
            randomUUID(),
            m.source,
            unassigned ? `sample-orphan-${day}-${i}` : sessionId,
            ts,
            unassigned ? 'C:/sample/unregistered-experiment' : p.path,
            unassigned ? null : projectIds[p.name],
            unassigned ? null : 'exact',
            m.provider,
            m.model,
            m.model,
            input,
            output,
            cacheRead,
            cacheWrite || null,
            reasoning,
            total,
            cost ? cost.total : null,
            cost ? 1 : 0,
            cost ? cost.pricingId : null,
            failed ? null : Math.floor(800 + rand() * 24_000),
            failed ? 'error' : 'ok',
            'Sample prompt preview — no real prompt content is stored.',
            JSON.stringify({ sample: true }),
            `sample://${m.source}/${day}.jsonl`,
            i + 1,
            new Date().toISOString(),
          );
          eventCount++;
        }
      }
    }

    // ---- value entries: realised, estimated, recurring, and one with none ----
    const v = (
      name: string,
      type: string,
      amount: number,
      daysAgo: number,
      realised: boolean,
      recurring = false,
      conf = 'high',
      desc = '',
    ) =>
      insValue.run(
        randomUUID(),
        projectIds[name],
        type,
        amount,
        new Date(now - daysAgo * 86_400_000).toISOString(),
        recurring ? 1 : 0,
        recurring ? 'monthly' : null,
        realised ? 1 : 0,
        conf,
        desc,
      );

    // High ROI project.
    v('Atlas Ledger', 'recurring_revenue', 2400, 110, true, true, 'high', 'Subscription revenue');
    v('Atlas Ledger', 'one_time_sale', 8500, 60, true, false, 'high', 'Enterprise onboarding');
    v('Atlas Ledger', 'strategic_value', 15000, 30, false, false, 'low', 'Estimated strategic value');

    // Medium.
    v('Kestrel Analytics', 'cost_savings', 900, 95, true, true, 'medium', 'Reporting automation');
    v('Kestrel Analytics', 'hours_saved', 3200, 40, true, false, 'medium', 'Analyst hours avoided');

    // Low ROI: value roughly covers cost, no more.
    v('Marina Booking', 'one_time_sale', 1800, 70, true, false, 'high', 'Fixed-price build');
    v('Marina Booking', 'estimated_revenue', 600, 20, false, false, 'low', 'Pipeline estimate');

    // Beacon Docs deliberately has NO value data (exercises 'Insufficient Data').

    // Negative ROI: heavy exploration, almost nothing realised.
    v('Orchard Scraper', 'cost_savings', 120, 50, true, false, 'low', 'Minor scripting savings');
    v('Orchard Scraper', 'estimated_revenue', 200, 15, false, false, 'low', 'Speculative resale estimate');

    insSub.run(randomUUID(), 'Anthropic', 'Max plan', 100, new Date(now - DAYS * 86_400_000).toISOString().slice(0, 10), 'token_share', 'Primary coding subscription');
    insSub.run(randomUUID(), 'OpenAI', 'Pro plan', 20, new Date(now - DAYS * 86_400_000).toISOString().slice(0, 10), 'session_share', 'Secondary');
  });

  tx();
  return eventCount;
}

function pickModel(r: number) {
  let acc = 0;
  for (const m of SAMPLE_MODELS) {
    acc += m.weight;
    if (r <= acc) return m;
  }
  return SAMPLE_MODELS[0];
}

function safeArr(s: unknown): string[] {
  try {
    const v = JSON.parse(String(s));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
