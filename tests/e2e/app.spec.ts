import { expect, test } from '@playwright/test';

import { cleanupE2eData, seedJobsBatch, uniqueRunId } from './helpers';

test.describe('JobLens navigation', () => {
  test('desktop navigates core pages via the top navbar', async ({ isMobile, page }) => {
    test.skip(isMobile, 'Desktop navigation uses the persistent top navbar.');

    const searchRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/v1/searches?')) {
        searchRequests.push(request.url());
      }
    });

    await page.goto('/');
    await expect(page.getByText('Priorita AI')).toBeVisible();

    await page.getByRole('link', { name: 'Offerte' }).click();
    await expect(page).toHaveURL(/\/jobs$/);
    await expect(page.getByRole('textbox', { name: 'Cerca offerte' })).toBeVisible();

    await page.getByRole('link', { name: 'Ricerche' }).click();
    await expect(page).toHaveURL(/\/searches$/);
    await expect(page.getByRole('button', { name: 'Nuova ricerca' })).toBeVisible();
    // The searches list must not poll in a loop on load.
    await page.waitForTimeout(1_500);
    expect(searchRequests.length).toBeLessThanOrEqual(6);

    await page.getByRole('link', { name: 'Attivita' }).click();
    await expect(page).toHaveURL(/\/activities$/);

    await page.getByRole('link', { name: 'Impostazioni' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Sessioni' })).toBeVisible();
  });
});

test.describe('JobLens layout', () => {
  const runId = uniqueRunId('layout');

  test.beforeAll(async () => {
    await cleanupE2eData(runId);
    // Enough offers that the list alone is taller than a phone viewport.
    await seedJobsBatch(runId, 14);
  });

  test.afterAll(async () => {
    await cleanupE2eData(runId);
  });

  async function openSeededJobs(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/jobs');
    await expect(page.getByRole('textbox', { name: 'Cerca offerte' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Cerca offerte' }).fill(`E2E Batch ${runId}`);
    // Wait until the filtered list has rendered several rows.
    await expect
      .poll(async () => page.locator('.job-list .list-group-item').count())
      .toBeGreaterThan(8);
  }

  test('desktop keeps the page fixed and scrolls each pane internally', async ({
    isMobile,
    page,
  }) => {
    test.skip(isMobile, 'Independent pane scrolling is the desktop layout.');

    await openSeededJobs(page);

    const metrics = await page.evaluate(() => {
      const list = document.querySelector('.job-list') as HTMLElement | null;
      return {
        documentScrolls:
          document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
        listScrolls: list ? list.scrollHeight > list.clientHeight + 1 : false,
        horizontalOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });

    // The document stays locked to the viewport; the list pane scrolls on its own.
    expect(metrics.documentScrolls).toBe(false);
    expect(metrics.listScrolls).toBe(true);
    expect(metrics.horizontalOverflow).toBe(false);
  });

  test('mobile scrolls the content area without horizontal overflow', async ({
    isMobile,
    page,
  }) => {
    test.skip(!isMobile, 'Content-area scrolling matters on the stacked mobile layout.');

    await openSeededJobs(page);

    const before = await page.evaluate(() => {
      const main = document.querySelector('.app-main') as HTMLElement | null;
      return {
        mainScrollable: main ? main.scrollHeight > main.clientHeight + 1 : false,
        horizontalOverflow:
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      };
    });

    // The stacked content must overflow the content area (not be clipped) and
    // must not overflow sideways.
    expect(before.mainScrollable).toBe(true);
    expect(before.horizontalOverflow).toBe(false);

    // And it must actually scroll down so content below the list is reachable.
    const scrolledTop = await page.evaluate(() => {
      const main = document.querySelector('.app-main') as HTMLElement;
      main.scrollTop = main.scrollHeight;
      return main.scrollTop;
    });
    expect(scrolledTop).toBeGreaterThan(0);
  });
});
