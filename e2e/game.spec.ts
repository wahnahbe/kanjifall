import { expect, test } from '@playwright/test';
import { toRomaji } from 'wanakana';

test('typing a falling word’s reading and pressing Enter scores a kill', async ({ page }) => {
  await page.goto('/?seed=42');
  await page.getByTestId('start-button').click();

  // Wait until the game is running AND the first word has actually spawned.
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
});
