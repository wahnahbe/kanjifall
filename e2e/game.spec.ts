import { expect, test, type Page } from '@playwright/test';
import { toRomaji } from 'wanakana';

async function dismissIntroAndKillFirstWord(page: Page) {
  // Wave intro comes first (spec §3.6): wait for the pause, dismiss with Enter.
  await page.waitForFunction(() => window.__kotoba?.snapshot().status === 'waveIntro');
  await expect(page.getByTestId('wave-intro')).toBeVisible();
  await page.keyboard.press('Enter');

  await page.waitForFunction(() => {
    const snap = window.__kotoba?.snapshot();
    return !!snap && snap.status === 'playing' && !!snap.firstAirborneReading;
  });
  const reading: string = await page.evaluate(
    () => window.__kotoba!.snapshot().firstAirborneReading!,
  );
  await page.keyboard.type(toRomaji(reading), { delay: 30 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('score')).not.toHaveText('0');
}

test('reading mode: intro → dismiss → type reading → kill scores', async ({ page }) => {
  await page.goto('/?seed=42&mode=reading&pool=n5');
  await dismissIntroAndKillFirstWord(page);
});

test('recall mode: gloss prompt still killed by typing the reading', async ({ page }) => {
  await page.goto('/?seed=42&mode=recall&pool=n5');
  await dismissIntroAndKillFirstWord(page);
});
