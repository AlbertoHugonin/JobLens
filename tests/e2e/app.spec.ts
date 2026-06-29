import { expect, test } from '@playwright/test';

test.describe('JobLens app smoke', () => {
  test('desktop navigates core pages and keeps searches loading bounded', async ({
    isMobile,
    page,
  }) => {
    test.skip(isMobile, 'Desktop navigation uses the persistent sidebar.');

    const searchRequests: string[] = [];

    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('/api/v1/searches?')) {
        searchRequests.push(url);
      }
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.getByRole('link', { name: /Ricerche/ }).click();
    await expect(page.getByRole('heading', { name: 'Ricerche' })).toBeVisible();
    await expect(page.getByText(/Wizard ricerca LinkedIn|Modifica ricerca LinkedIn/)).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(searchRequests.length).toBeLessThanOrEqual(6);

    await page.getByRole('link', { name: /Offerte/ }).click();
    await expect(page.getByRole('heading', { name: 'Offerte' })).toBeVisible();

    await page.getByRole('link', { name: /Attivita/ }).click();
    await expect(page.getByRole('heading', { name: 'Attivita' })).toBeVisible();

    await page.getByRole('link', { name: /Impostazioni/ }).click();
    await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();
  });

  test('mobile renders searches and jobs without horizontal overflow', async ({ page }) => {
    await page.goto('/searches');
    await expect(page.getByRole('heading', { name: 'Ricerche' })).toBeVisible();
    await expect(page.getByText(/Sessione LinkedIn/)).toBeVisible();

    const searchOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(searchOverflow).toBe(false);

    await page.goto('/jobs');
    await expect(page.getByRole('heading', { name: 'Offerte' })).toBeVisible();

    const jobsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(jobsOverflow).toBe(false);
  });
});
