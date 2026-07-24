import { expect, test, type Page } from '@playwright/test';
import { toRomaji } from 'wanakana';

interface StatsOverviewResponse {
  trend: { date: string; words: number; accuracy: number }[];
}

/** Waits until either an airborne word is available to type against, or the
 *  wave/run has moved past 'playing' (wave cleared → next 'waveIntro', or
 *  game over). Shared exit condition for a single kill and the full-wave
 *  loop built on top of it below. */
async function waitForAirborneOrWaveEnd(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const snap = window.__kotoba?.snapshot();
    return !!snap && (snap.status !== 'playing' || !!snap.firstAirborneReading);
  });
}

/** Types the current oldest airborne word's reading and submits it. Caller
 *  must already know one is available (see waitForAirborneOrWaveEnd). */
async function killFirstAirborneWord(page: Page): Promise<void> {
  const reading = await page.evaluate(() => window.__kotoba!.snapshot().firstAirborneReading!);
  await page.keyboard.type(toRomaji(reading), { delay: 30 });
  await page.keyboard.press('Enter');
}

async function dismissIntroAndKillFirstWord(page: Page) {
  // Wave intro comes first (spec §3.6): wait for the pause, dismiss with Enter.
  await page.waitForFunction(() => window.__kotoba?.snapshot().status === 'waveIntro');
  await expect(page.getByTestId('wave-intro')).toBeVisible();
  await page.keyboard.press('Enter');

  await waitForAirborneOrWaveEnd(page);
  await killFirstAirborneWord(page);
  await expect(page.getByTestId('score')).not.toHaveText('0');
}

/**
 * Kills every remaining word of the wave in progress, one at a time as each
 * spawns, until the wave clears. This matters because a single kill (as in
 * dismissIntroAndKillFirstWord, above) never fires GameEngine's
 * 'waveCleared' event — and it's waveCleared that makes RunRecorder actually
 * flush buffered attempts to the API (src/data/recorder.ts). Proving DB
 * persistence therefore needs the whole wave played out, not just one word.
 * Once the wave clears, the engine begins the next one and pauses again in
 * 'waveIntro' (GameEngine.beginWave) — that transition is this loop's exit
 * condition.
 */
async function clearRestOfWave(page: Page): Promise<void> {
  for (;;) {
    await waitForAirborneOrWaveEnd(page);
    const status = await page.evaluate(() => window.__kotoba!.snapshot().status);
    if (status !== 'playing') return;
    await killFirstAirborneWord(page);
  }
}

test('reading mode: intro → dismiss → type reading → kill scores', async ({ page }) => {
  // Clearing the rest of wave 1 (up to 4 more words at ~3.2s apart) plus the
  // DB-flush poll below comfortably exceeds Playwright's 30s default.
  test.setTimeout(60_000);
  await page.goto('/?seed=42&mode=reading&pool=n5');
  await dismissIntroAndKillFirstWord(page);

  // spec §8: "assert ... the attempt row exists in the DB." A single kill
  // only buffers the attempt in memory; clearing the rest of wave 1 fires
  // waveCleared, which is when the recorder flushes to SQLite (via
  // server/routes/runs.ts's POST /:id/events). The flush itself is an
  // async, fire-and-forget network call from the game's perspective, so the
  // DB row can lag a beat behind the client-visible wave transition — hence
  // polling rather than a single immediate check.
  await clearRestOfWave(page);
  await expect
    .poll(
      async () => {
        const overview = await page.request.get('/api/stats/overview');
        if (!overview.ok()) return -1;
        const body = (await overview.json()) as StatsOverviewResponse;
        const today = body.trend[body.trend.length - 1];
        return today.words;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThanOrEqual(1); // the kill(s) landed in SQLite — rides the vite proxy → API → e2e DB
});

test('recall mode: gloss prompt still killed by typing the reading', async ({ page }) => {
  await page.goto('/?seed=42&mode=recall&pool=n5');
  await dismissIntroAndKillFirstWord(page);
});
