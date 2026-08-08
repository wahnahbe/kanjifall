import { expect, test, type Page } from '@playwright/test';
import { toRomaji } from 'wanakana';

interface StatsOverviewResponse {
  trend: { date: string; words: number; accuracy: number }[];
}

/** Shape of GET /api/plan?pool=... that matters to these specs (server/plan.ts). */
interface PlanResponse {
  newCardIds: string[];
  seenCards: { id: string; weight: number }[];
}

/**
 * Characters AcquisitionCeremony's own keydown handler (and InputBuffer
 * underneath it) actually accept while typing a reading — see
 * AcquisitionCeremony.tsx's onKey and InputBuffer.ts's INPUT_KEY, both
 * `/^[a-zA-Z-]$/`. A romaji reading that falls outside this can never be
 * typed correctly: the disallowed character is silently dropped rather than
 * buffered, so Enter keeps rejecting the same (now-wrong) buffer forever.
 * Confirmed in the N5 pool: not the katakana ー words (wanakana's toRomaji
 * renders those as plain doubled vowels, e.g. コーヒー → "koohii"), but
 * 金曜日 → "kin'youbi", where wanakana inserts an apostrophe to disambiguate
 * ん before a や/ゆ/よ-row kana. Escape is equally valid here — spec §3.1: a
 * skipped word still counts as introduced — so it is the escape hatch for
 * any reading this buffer cannot faithfully accept.
 */
const TYPABLE_ROMAJI = /^[a-zA-Z-]+$/;

/**
 * Walks the acquisition ceremony (spec §3.1) from wave 1's pause through to
 * 'playing'. The e2e DB is wiped before every run (global-setup.ts), so on a
 * fresh run every pool card is new and the ceremony is guaranteed to show at
 * least one card before wave 1 can start. Types each card's displayed
 * reading (ceremony-reading, i.e. card.kana[0]) in romaji and submits with
 * Enter; a reading that wouldn't round-trip cleanly (see TYPABLE_ROMAJI) is
 * skipped with Escape instead.
 */
async function clearCeremony(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__kotoba?.snapshot().status === 'waveIntro');
  // Fresh e2e DB: every word is new, so the ceremony is showing.
  while (await page.getByTestId('ceremony').isVisible().catch(() => false)) {
    const reading = await page.getByTestId('ceremony-reading').textContent();
    if (reading === null) break;
    const romaji = toRomaji(reading);
    if (TYPABLE_ROMAJI.test(romaji)) {
      await page.keyboard.type(romaji, { delay: 20 });
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(50);
  }
  await page.waitForFunction(() => window.__kotoba?.snapshot().status === 'playing');
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
  // Wave intro comes first (spec §3.6): the acquisition ceremony pauses the
  // wave until every new card has been typed through (or escaped past).
  await clearCeremony(page);

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

  // Captured before any card is introduced, so the persistence proof below
  // has a known-empty baseline to move away from.
  const before = (await (await page.request.get('/api/plan?pool=n5')).json()) as PlanResponse;
  expect(before.seenCards).toHaveLength(0); // globalSetup wiped the e2e DB

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

  // There is no introductions endpoint, but /api/plan observes the same
  // table (server/plan.ts): a card that has been introduced (typed through
  // or escaped past in the ceremony) must move out of newCardIds and into
  // seenCards. Same flush this poll rides as the overview one above —
  // both wait on RunRecorder's waveCleared-triggered batch landing in SQLite.
  await expect
    .poll(
      async () => {
        const res = await page.request.get('/api/plan?pool=n5');
        if (!res.ok()) return 0;
        const plan = (await res.json()) as PlanResponse;
        return plan.seenCards.length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
});

test('recall mode: gloss prompt still killed by typing the reading', async ({ page }) => {
  await page.goto('/?seed=42&mode=recall&pool=n5');
  await dismissIntroAndKillFirstWord(page);
});
