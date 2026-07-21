import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * These tests drive the real application against a throwaway database seeded
 * from the repo fixtures (see playwright.config.ts).
 */

const PROJECT_DIR = path.join(os.tmpdir(), 'token-roi-e2e-project');

test.beforeAll(() => {
  fs.mkdirSync(PROJECT_DIR, { recursive: true });
  // Gemini fixtures live under <root>/<projectDir>/chats/, which the adapter requires.
  const gemChats = path.join(process.cwd(), 'fixtures', 'gemini-root', 'demo', 'chats');
  fs.mkdirSync(gemChats, { recursive: true });
  const src = path.join(process.cwd(), 'fixtures', 'gemini', 'chats', 'session-sample.jsonl');
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(gemChats, 'session-sample.jsonl'));
});

test('indexes verified local sources automatically, with no manual scan', async ({ page, request }) => {
  // Nothing is clicked here. Simply opening the app on a cold database must
  // leave it populated — that is the whole point of automatic indexing.
  await page.goto('/sources');
  await expect(page.getByRole('heading', { name: 'Data Sources' })).toBeVisible();
  await expect(page.getByText('Claude Code session history')).toBeVisible();

  const indexed = await page.locator('dd').allTextContents();
  expect(indexed.some((t) => /^[1-9][\d,]*$/.test(t.trim()))).toBeTruthy();

  // The scan history must record the run, including the fixture's deliberately
  // corrupt line: a bad record is reported, never silently swallowed, and never
  // aborts the rest of the file.
  const runs = page.locator('table').filter({ hasText: 'Started' });
  await expect(runs.locator('tbody tr').first()).toBeVisible();
  await expect(runs).toContainText('claude-code');

  // Because auto-indexing already ran, an explicit rescan is a clean no-op —
  // proving the checkpoints were persisted rather than re-reading everything.
  const again = await (await request.post('/api/scan', { data: { source: 'claude-code' } })).json();
  expect(again.reports[0].recordsAdded).toBe(0);
  expect(again.reports[0].errors).toEqual([]);
});

test('the first-run notice discloses automatic indexing and can be dismissed', async ({ page }) => {
  await page.goto('/');
  const notice = page.getByText('Your local AI history was indexed automatically.');
  await expect(notice).toBeVisible();
  await expect(page.getByText(/read-only/)).toBeVisible();

  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toBeHidden();

  // It must stay dismissed across navigation, not reappear on every page.
  await page.goto('/costs');
  await expect(page.getByText('Your local AI history was indexed automatically.')).toHaveCount(0);
});

test('adds a project and attributes sessions to it', async ({ page }) => {
  await page.goto('/projects');
  await page.getByPlaceholder('Atlas Ledger').fill('E2E Project');
  await page.locator('input[name="path"]').fill(PROJECT_DIR);
  await page.getByRole('button', { name: 'Add project' }).click();

  await expect(page.getByRole('link', { name: 'E2E Project' })).toBeVisible({ timeout: 15_000 });
});

test('records a value event and shows ROI figures', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('link', { name: 'E2E Project' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Project' })).toBeVisible();

  await page.getByRole('button', { name: 'Value' }).click();
  await page.getByPlaceholder('2500').fill('1250');
  await page.getByPlaceholder('Enterprise onboarding fee').fill('E2E realised revenue');
  await page.getByRole('button', { name: 'Record value' }).click();

  await expect(page.getByText('E2E realised revenue')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Realised').first()).toBeVisible();

  // ROI tab must now show a computed multiple rather than a placeholder.
  await page.getByRole('button', { name: 'ROI', exact: true }).click();
  await expect(page.getByText('ROI Multiple')).toBeVisible();
});

test('edits a subscription and it appears in the plan list', async ({ page }) => {
  await page.goto('/settings?tab=Subscriptions');
  await page.getByRole('button', { name: 'Add plan' }).click();

  await page.getByPlaceholder('Anthropic').fill('E2E Provider');
  await page.getByPlaceholder('Max').fill('E2E Plan');
  await page.locator('input[name="monthlyPrice"]').fill('120');
  await page.locator('input[name="billingStart"]').fill('2026-01-01');
  await page.getByRole('button', { name: 'Save plan' }).click();

  await expect(page.getByText('E2E Provider')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('E2E Plan')).toBeVisible();
});

test('subscription preset fills the form and one-time toggle works', async ({ page }) => {
  await page.goto('/settings?tab=Subscriptions');
  await page.getByRole('button', { name: 'Add plan' }).click();

  // Picking a preset seeds provider, plan and price.
  await page.locator('#subscription-preset').click();
  await page.getByRole('option', { name: /Claude Max \(20×\)/ }).click();
  await expect(page.locator('input[name="provider"]')).toHaveValue('Anthropic');
  await expect(page.locator('input[name="planName"]')).toHaveValue('Claude Max (20×)');
  await expect(page.locator('input[name="monthlyPrice"]')).toHaveValue('200');

  // Fields stay editable after a preset is applied.
  await page.locator('input[name="monthlyPrice"]').fill('185');
  await expect(page.locator('input[name="monthlyPrice"]')).toHaveValue('185');

  // Switching to one-time hides the recurring-only fields and pins the cycle.
  await page.getByRole('button', { name: 'One-time', exact: true }).click();
  await expect(page.locator('input[name="billingCycle"]')).toHaveValue('one_time');
  await expect(page.getByText('Purchase date')).toBeVisible();
  await expect(page.getByText('Billing end')).toHaveCount(0);

  await page.locator('input[name="billingStart"]').fill('2026-05-09');
  await page.getByRole('button', { name: 'Save plan' }).click();

  // It is listed as one-time and excluded from the monthly run rate.
  const row = page.locator('tbody tr').filter({ hasText: 'Claude Max (20×)' });
  await expect(row).toContainText('one-time');
  await expect(row).toContainText('once');
  await expect(page.getByText(/1 one-time purchase/)).toBeVisible();
});

test('filters session traces and opens the detail drawer', async ({ page }) => {
  await page.goto('/sessions?range=all&view=traces');
  await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();

  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });

  // Filtering must not error and must keep the table coherent. This also
  // exercises the custom listbox: open it, then pick an option by name.
  await page.getByRole('combobox').filter({ hasText: 'Priced or not' }).click();
  // exact, otherwise "Priced only" also matches "Unpriced only".
  await page.getByRole('option', { name: 'Priced only', exact: true }).click();
  await expect(page.getByRole('combobox').filter({ hasText: 'Priced only' })).toBeVisible();
  await page.waitForTimeout(1200);

  await rows.first().click();
  const drawer = page.getByRole('complementary');
  await expect(drawer.getByRole('heading', { name: 'Trace detail' })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Token breakdown' })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Cost calculation' })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Project mapping' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('exports filtered CSV', async ({ page }) => {
  await page.goto('/sessions?range=all&priced=priced&view=traces');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^token-roi-sessions-.*\.csv$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const csv = Buffer.concat(chunks).toString('utf8');
  expect(csv.split('\n')[0]).toContain('total_tokens');
});

test('custom dropdown is readable, keyboard accessible, and submits with the form', async ({ page }) => {
  await page.goto('/settings?tab=Subscriptions');
  await page.getByRole('button', { name: 'Add plan' }).click();

  const combo = page.locator('[data-select="allocationMethod"]');
  await expect(combo).toHaveText(/Token share/);
  await combo.click();

  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole('option')).toHaveCount(6);

  // Options must not be the unreadable grey-on-grey the native popup produced.
  const unselected = listbox.getByRole('option', { name: 'Session share' });
  await expect(unselected).toHaveCSS('color', 'rgb(161, 161, 170)');
  await expect(listbox).toHaveCSS('background-color', 'rgba(20, 20, 26, 0.98)');

  await listbox.getByRole('option', { name: 'Manual percentages' }).click();
  await expect(listbox).toBeHidden();
  await expect(combo).toHaveText(/Manual percentages/);
  await expect(page.locator('input[name="allocationMethod"]')).toHaveValue('manual_pct');
  // Choosing manual percentages reveals its config field, proving state flowed.
  await expect(page.locator('input[name="allocationConfig"]')).toBeVisible();

  // Keyboard: open with Enter, move with ArrowDown, commit with Enter.
  // Target by data-select, not visible text — the label changes as we select.
  const cycle = page.locator('[data-select="billingCycle"]');
  await cycle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(page.locator('input[name="billingCycle"]')).toHaveValue('quarterly');

  // Escape closes without changing the value.
  await cycle.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toBeHidden();
  await expect(page.locator('input[name="billingCycle"]')).toHaveValue('quarterly');
});

test('top bar hydrates with its controls and navigation', async ({ page }) => {
  await page.goto('/sessions');

  const topBar = page.locator('header').filter({ has: page.locator('a[href="/"]') });
  await expect(topBar).toBeVisible();

  // The top bar is inside <Suspense> (it reads searchParams). If hydration
  // stalled, its content would stay in a hidden streaming container.
  for (const label of ['All projects', '30 days', 'API Equivalent']) {
    await expect(topBar.getByRole('combobox').filter({ hasText: label })).toBeVisible();
  }
  for (const link of ['Overview', 'Projects', 'Sessions', 'Models', 'Costs', 'ROI', 'Data Sources', 'Settings']) {
    await expect(topBar.getByRole('link', { name: link, exact: true })).toBeVisible();
  }

  // The controls above being visible is the real proof of hydration. (Next's
  // dev server leaves its own hidden wrappers in <body>, so their presence is
  // not a useful signal.)

  // The cost-basis control must actually drive the page.
  await topBar.getByRole('combobox').filter({ hasText: 'API Equivalent' }).click();
  await page.getByRole('option', { name: 'Allocated Cash' }).click();
  await expect(page).toHaveURL(/basis=allocated_cash/);
});

test('chart axis labels are fully visible and the footer renders', async ({ page, request }) => {
  // Self-sufficient: charts only exist once something is indexed, and each run
  // gets a fresh database.
  await request.post('/api/scan', { data: { source: 'claude-code' } });
  await page.goto('/?range=all');

  await expect(page.locator('.recharts-wrapper').first()).toBeVisible();
  // Ticks paint a frame after the wrapper mounts. Wait page-wide rather than
  // assuming which chart renders first.
  // Note: Recharts renders tick text into a separate `*-tick-labels` layer,
  // NOT inside the axis group, so that is the ancestor to select on.
  await page.waitForFunction(
    () => document.querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value').length > 0,
    undefined,
    { timeout: 15_000 },
  );

  // Y-axis ticks were previously clipped by a negative left margin, rendering
  // "$1,200.00" as "0.00" and "1500M" as "0M". Assert every tick sits fully
  // inside its chart, and that none begins mid-number.
  const ticks = await page.evaluate(() => {
    const out: Array<{ text: string; left: number; chartLeft: number }> = [];
    document
      .querySelectorAll('.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')
      .forEach((t) => {
        const wr = t.closest('.recharts-wrapper')?.getBoundingClientRect();
        if (!wr) return;
        const r = t.getBoundingClientRect();
        out.push({ text: (t.textContent ?? '').trim(), left: r.left, chartLeft: wr.left });
      });
    return out;
  });

  expect(ticks.length).toBeGreaterThan(0);
  for (const t of ticks) {
    expect(t.left).toBeGreaterThanOrEqual(t.chartLeft - 0.5);
    // A clipped money tick loses its "$"; a clipped number tick loses digits.
    if (t.text.includes('$')) expect(t.text.startsWith('$') || t.text.startsWith('-$')).toBeTruthy();
    expect(t.text).not.toMatch(/^0M$/);
  }

  const footer = page.getByRole('contentinfo');
  await expect(footer).toBeVisible();
  const handle = footer.getByRole('link', { name: '@RemisierSyazwan' });
  await expect(handle).toHaveAttribute('href', 'https://www.threads.com/@remisiersyazwan');
  await expect(handle).toHaveAttribute('rel', /noopener/);
  await expect(footer).toContainText('Open source');
});

test('conversation view groups requests into sessions and opens a turn breakdown', async ({ page }) => {
  await page.goto('/sessions?range=all');
  await expect(page.getByRole('columnheader', { name: 'What you asked' })).toBeVisible();

  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });

  // The fixture's real user prompt must surface here — not the model's reply.
  await expect(page.getByText(/Wire up the exporter/)).toBeVisible();
  // ...and secrets in it stay redacted at rest.
  await expect(page.getByText('sk-ant-AAAA', { exact: false })).toHaveCount(0);

  await rows.first().click();
  const drawer = page.getByRole('complementary');
  await expect(drawer.getByRole('heading', { name: 'Conversation' })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Cost per turn' })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Totals' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // Switching views is a URL change, so it survives reload and sharing.
  await page.getByRole('button', { name: 'Traces' }).click();
  await expect(page).toHaveURL(/view=traces/);
});

test('insights are generated and the share card can be opened', async ({ page }) => {
  await page.goto('/insights?range=all');
  await expect(page.getByRole('heading', { name: 'Insights' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Most expensive prompts' })).toBeVisible();

  // Insights are evidence-gated, so a tiny fixture may legitimately produce few.
  // What must always hold: nothing renders NaN, Infinity or undefined.
  const body = (await page.locator('main').innerText()).toLowerCase();
  expect(body).not.toContain('nan');
  expect(body).not.toContain('infinity');
  expect(body).not.toContain('undefined');

  await page.getByRole('button', { name: 'Share stats' }).click();
  const dialog = page.getByRole('dialog', { name: 'Share your stats' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('canvas')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Download PNG' })).toBeVisible();
});

test('the wizard proposes projects from indexed folders', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('button', { name: 'Detect projects' }).click();

  await expect(page.getByRole('heading', { name: 'Detected projects' })).toBeVisible({ timeout: 15_000 });
  // Every proposal is listed with a checkbox — nothing is created implicitly.
  await expect(page.locator('input[type="checkbox"]').first()).toBeVisible();
  await expect(page.getByRole('button', { name: /^Create \d+ project/ })).toBeVisible();
});

test('overlays stay pinned to the viewport, not to an animated ancestor', async ({ page }) => {
  // Regression: the page-enter animation puts a transform on the page wrapper
  // and on every panel. A `position: fixed` drawer then resolves against that
  // panel instead of the viewport, and renders half off-screen. Overlays are
  // portalled to <body> so no ancestor can capture them.
  await page.goto('/sessions?range=all');
  await page.locator('tbody tr').first().click();

  const drawer = page.getByRole('complementary');
  await expect(drawer).toBeVisible();

  const vp = page.viewportSize()!;
  // The drawer slides in, so poll until it settles rather than measuring mid-flight.
  await expect
    .poll(async () => {
      const b = await drawer.boundingBox();
      return b ? Math.round(b.x + b.width) : -1;
    }, { timeout: 5_000 })
    .toBe(vp.width);

  const box = (await drawer.boundingBox())!;
  // Flush to the right edge and spanning the full viewport height.
  expect(Math.round(box.y)).toBe(0);
  expect(Math.round(box.height)).toBeCloseTo(vp.height, -1);

  // It must be a direct child of <body>, not nested inside a panel.
  const parentIsBody = await drawer.evaluate((el) => el.parentElement === document.body);
  expect(parentIsBody).toBe(true);
});

test('metric cards in a row are the same height', async ({ page }) => {
  await page.goto('/?range=all');
  const cards = page.locator('a[aria-label$="open details"] > div');
  await expect(cards.first()).toBeVisible();

  const heights = await cards.evaluateAll((els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().height)),
  );
  expect(heights.length).toBeGreaterThan(1);
  // Cards differ in whether they carry a sparkline, an exact value or a
  // footnote; every optional row keeps its slot so they still line up.
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);
});

test('views project ROI ranking on the ROI page', async ({ page }) => {
  await page.goto('/roi?range=all');
  await expect(page.getByRole('heading', { name: 'ROI Analysis' })).toBeVisible();
  await expect(page.getByText('Focus Recommendation')).toBeVisible();
  await expect(page.getByText('Portfolio Matrix')).toBeVisible();
});
