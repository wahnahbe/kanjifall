import { expect, test, type Page } from '@playwright/test';
import { toRomaji } from 'wanakana';

/** Shape of GET /api/plan?pool=list:<id> that this spec cares about (server/plan.ts). */
interface ListPlanResponse {
  newCardIds: string[];
  seenCards: { id: string }[];
}

/**
 * Types through the ceremony card(s) showing at wave start — same shape as
 * game.spec.ts's clearCeremony. This list's only reading-reachable member is
 * 犬 (a bundled N5 card; the list's other member, ぺけぺけ, is a kana-only
 * custom card that server/plan.ts's computeListRunPlan excludes entirely
 * under mode=reading — spec §5.4), so the ceremony can show at most one
 * card. It can also show none: global-setup.ts wipes the e2e DB once before
 * the whole `npm run e2e` run, and Playwright schedules different spec
 * files onto different workers by default, so a concurrently-running
 * game.spec.ts test could in principle already have introduced this same
 * built-in card. Looping (rather than assuming exactly one) covers both
 * cases for free.
 */
async function clearCeremony(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__kotoba?.snapshot().status === 'waveIntro');
  while (await page.getByTestId('ceremony').isVisible().catch(() => false)) {
    const reading = await page.getByTestId('ceremony-reading').textContent();
    if (reading === null) break;
    await page.keyboard.type(toRomaji(reading), { delay: 20 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
  }
  await page.waitForFunction(() => window.__kotoba?.snapshot().status === 'playing');
}

/** See game.spec.ts's identically-named helper: waits for either an
 *  airborne word to type against, or the wave/run moving past 'playing'. */
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

/**
 * Kills every remaining word of the wave in progress, one at a time, until
 * that wave ends — needed here for the same root cause game.spec.ts's
 * identically-purposed helper exists for: RunRecorder (src/data/recorder.ts)
 * only flushes buffered attempts/introductions on the engine's
 * 'waveCleared' or 'gameOver' event, never on an individual kill. This
 * list's only reading-reachable card is 犬, so once it's introduced,
 * Spawner fills the *entire* wave with repeats of it (drawSeen's
 * refill-on-exhaustion, src/engine/Spawner.ts) — one kill leaves several
 * more instances of the same word still queued, and 'waveCleared' does not
 * fire until every one of them is gone. Skipping this step is exactly what
 * makes the persistence poll below stall.
 *
 * Unlike game.spec.ts's version, this cannot key off `status !== 'playing'`
 * to detect the wave ending: this list never has a second card to
 * introduce, so every wave *after* this one starts with zero ceremony
 * cards, and AcquisitionCeremony resolves a zero-card ceremony in the same
 * render it mounts in (`cards.length === 0` → `onComplete` fires
 * immediately) — the 'waveIntro' pause between waves is too brief for
 * polling to reliably observe. A status-keyed loop can silently sail past
 * several such wave boundaries without ever catching one, chasing
 * Spawner's ever-growing `waveSizeGrowth` wave size toward the test
 * timeout (confirmed while writing this: it ran 8 kills across at least
 * two silently-crossed wave boundaries in 23s with `status` never once
 * observed outside 'playing'). `wave` doesn't have that problem —
 * GameEngine.beginWave sets it synchronously and it only ever increases —
 * so comparing against the wave number in effect when this function was
 * called is a reliable way to detect that *this* wave specifically has
 * ended, regardless of how briefly any single 'waveIntro' pause lasts.
 */
async function clearRestOfWave(page: Page): Promise<void> {
  const startWave = await page.evaluate(() => window.__kotoba!.snapshot().wave);
  for (;;) {
    await page.waitForFunction((wave) => {
      const snap = window.__kotoba?.snapshot();
      return !!snap && (snap.wave > wave || snap.status === 'gameOver' || !!snap.firstAirborneReading);
    }, startWave);
    const snap = await page.evaluate(() => window.__kotoba!.snapshot());
    if (snap.wave > startWave || snap.status === 'gameOver') return;
    await killFirstAirborneWord(page);
  }
}

/** Import a two-line list through the real UI — one bare word that resolves
 *  against the bundled data, one full-line custom that cannot — then play it
 *  in reading mode: the resolved word gets its ceremony and an attempt lands
 *  (custom-list-import spec §8). The kana-only custom is deliberately
 *  unreachable in reading mode — hard-asserted against the mode-scoped plan
 *  right after save, not just relied on implicitly via the ceremony. */
test('import a list and play it: ceremony, kill, persistence', async ({ page }) => {
  // Clearing the rest of wave 1 (this list's single playable card, repeated
  // to fill the wave — see clearRestOfWave) plus the DB-flush poll below
  // comfortably exceeds Playwright's 30s default, same as game.spec.ts.
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByTestId('start-button').click();
  await page.getByTestId('import-button').click();

  await page.getByTestId('import-name').fill('e2e-list');
  await page.getByTestId('import-text').fill('犬\nぺけぺけ,ぺけぺけ,e2e test word');
  await page.getByTestId('preview-button').click();
  await expect(page.getByTestId('save-button')).toHaveText(/Save 2 words/);
  await page.getByTestId('save-button').click();

  // Back on setup with the new list preselected; reading mode is the default.
  await expect(page.getByTestId('setup')).toBeVisible();

  // The reading-mode plan must offer exactly the resolved built-in card; the
  // kana-only custom is mode-unreachable and must be absent — this is the
  // assertion that turns red if the exclusion ever regresses. (Without it,
  // clearCeremony would simply type through however many cards appear and
  // the closing poll only checks seenCards.length > 0, so a regression here
  // would stay silently green.) listId is fetched once, here, and reused
  // below for the persistence poll rather than fetched twice.
  const listId = ((await (await page.request.get('/api/lists')).json()) as { id: number }[])[0].id;
  const readingPlan = (await (
    await page.request.get(`/api/plan?pool=list:${listId}&mode=reading`)
  ).json()) as ListPlanResponse;
  expect(readingPlan.newCardIds).toHaveLength(1);
  expect(readingPlan.newCardIds[0]).not.toMatch(/^custom-/);

  await page.getByTestId('begin-button').click();

  // Wave intro (spec §3.6) shows the resolved word's ceremony; the kana-only
  // custom never reaches it (excluded from reading mode's plan entirely —
  // hard-asserted above).
  await clearCeremony(page);

  // Kill the airborne word: proves the client-side attempt lands immediately
  // (score updates without waiting on any network round trip).
  await waitForAirborneOrWaveEnd(page);
  await killFirstAirborneWord(page);
  await expect(page.getByTestId('score')).not.toHaveText('0');

  // Clear the rest of wave 1 so 'waveCleared' fires and RunRecorder actually
  // flushes the buffered attempt/introduction batch to SQLite.
  await clearRestOfWave(page);

  // The list's plan sees the member as met once the batch lands.
  await expect
    .poll(
      async () => {
        const res = await page.request.get(`/api/plan?pool=list:${listId}`);
        if (!res.ok()) return 0;
        const plan = (await res.json()) as ListPlanResponse;
        return plan.seenCards.length;
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(0);
});
