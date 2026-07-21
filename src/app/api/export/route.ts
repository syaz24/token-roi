import { NextResponse } from 'next/server';
import { resolveFilters, str, type SearchParams } from '@/lib/params';
import {
  byModel,
  listEvents,
  projectRoiTable,
  totals,
  type SessionFilters,
} from '@/lib/queries';
import { money } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** CSV export honouring the current filters. GET /api/export?type=... */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp: SearchParams = Object.fromEntries(url.searchParams.entries());
  const f = resolveFilters(sp);
  const type = str(sp.type) ?? 'projects';

  let rows: Array<Record<string, unknown>> = [];
  let name = 'export';

  switch (type) {
    case 'projects': {
      name = 'project-summary';
      rows = projectRoiTable(f).map((p) => ({
        project: p.name,
        path: p.path,
        category: p.category ?? '',
        status: p.status,
        tokens: p.tokens,
        requests: p.events,
        sessions: p.sessions,
        api_cost_usd: round(p.apiCost),
        allocated_cash_usd: round(p.cashCost),
        cost_basis: f.basis,
        cost_used_usd: round(p.cost),
        value_usd: round(p.value),
        realised_value_usd: round(p.realisedValue),
        estimated_value_usd: round(p.estimatedValue),
        net_value_usd: p.netValue == null ? '' : round(p.netValue),
        roi_pct: p.roiPct == null ? '' : round(p.roiPct, 1),
        roi_multiple: p.roiMultiple == null ? '' : round(p.roiMultiple, 3),
        value_per_mtok_usd: p.valuePerMTok == null ? '' : round(p.valuePerMTok),
        pricing_coverage_pct: round(p.pricingCoverage * 100, 1),
        break_even_passed: p.breakEvenPassed,
        recommendation: p.recommendation.recommendation,
        recommendation_confidence: p.recommendation.confidence,
      }));
      break;
    }
    case 'sessions': {
      name = 'sessions';
      const sf: SessionFilters = {
        ...f,
        source: str(sp.source),
        provider: str(sp.provider),
        model: str(sp.model),
        status: str(sp.status),
        minTokens: sp.minTokens ? Number(sp.minTokens) : null,
        minCost: sp.minCost ? Number(sp.minCost) : null,
        assigned: (str(sp.assigned) as any) ?? 'all',
        pricedOnly: (str(sp.priced) as any) ?? 'all',
        search: str(sp.q),
        limit: 500,
      };
      // Page through so a filtered export is complete, with a hard safety cap.
      let cursor: string | null = null;
      const out: Array<Record<string, unknown>> = [];
      for (let i = 0; i < 200; i++) {
        const page = listEvents({ ...sf, cursor });
        for (const r of page.rows) {
          out.push({
            timestamp: r.timestamp,
            project: r.projectName ?? '',
            source: r.source,
            provider: r.provider ?? '',
            model: r.model ?? '',
            input_tokens: r.inputTokens ?? '',
            output_tokens: r.outputTokens ?? '',
            cache_read_tokens: r.cacheReadTokens ?? '',
            cache_write_tokens: r.cacheWriteTokens ?? '',
            reasoning_tokens: r.reasoningTokens ?? '',
            total_tokens: r.totalTokens,
            api_cost_usd: r.calculatedCostUsd == null ? '' : round(r.calculatedCostUsd, 6),
            priced: !!r.priced,
            duration_ms: r.durationMs ?? '',
            status: r.status,
            session_id: r.sessionId,
            mapping_method: r.mappingMethod ?? '',
            source_file: r.sourceFile ?? '',
          });
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      rows = out;
      break;
    }
    case 'models': {
      name = 'model-usage';
      rows = byModel(f).map((m) => ({
        model: m.model ?? 'unknown',
        provider: m.provider ?? '',
        requests: m.events,
        sessions: m.sessions,
        tokens: m.tokens,
        api_cost_usd: m.priced ? round(m.cost) : '',
        priced: !!m.priced,
        share_pct: round(m.share * 100, 2),
        avg_tokens_per_request: round(m.avgTokensPerRequest, 0),
      }));
      break;
    }
    case 'costs': {
      name = 'cost-analysis';
      const t = totals(f);
      rows = [
        { metric: 'total_tokens', value: t.tokens },
        { metric: 'input_tokens', value: t.input },
        { metric: 'output_tokens', value: t.output },
        { metric: 'cache_read_tokens', value: t.cacheRead },
        { metric: 'cache_write_tokens', value: t.cacheWrite },
        { metric: 'reasoning_tokens', value: t.reasoning },
        { metric: 'api_equivalent_cost_usd', value: round(t.apiCost) },
        { metric: 'unpriced_events', value: t.unpricedEvents },
        { metric: 'unpriced_tokens', value: t.unpricedTokens },
        { metric: 'pricing_coverage_pct', value: round(t.pricingCoverage * 100, 2) },
      ];
      break;
    }
    case 'roi': {
      name = 'roi-analysis';
      rows = projectRoiTable(f).map((p) => ({
        project: p.name,
        cost_basis: f.basis,
        cost_usd: round(p.cost),
        value_usd: round(p.value),
        net_value_usd: p.netValue == null ? '' : round(p.netValue),
        roi_pct: p.roiPct == null ? '' : round(p.roiPct, 1),
        roi_multiple: p.roiMultiple == null ? '' : round(p.roiMultiple, 3),
        break_even_passed: p.breakEvenPassed,
        break_even_remaining_usd: round(p.breakEvenRemaining),
        realised_share_pct: round(p.realisedShare * 100, 1),
        recommendation: p.recommendation.recommendation,
        score: p.recommendation.score,
        factors: p.recommendation.factors.map((x) => `${x.label} (${x.points})`).join('; '),
      }));
      break;
    }
    default:
      return NextResponse.json({ error: `Unknown export type: ${type}` }, { status: 400 });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const csv = toCsv(rows);
  return new NextResponse(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="token-roi-${name}-${stamp}.csv"`,
    },
  });
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (!rows.length) return 'no_data\n';
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n') + '\n';
}
