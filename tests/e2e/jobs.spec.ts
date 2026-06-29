import { expect, test } from '@playwright/test';

import { apiUrl, cleanupE2eData, seedJobScenario, uniqueRunId } from './helpers';

test.describe('Jobs workflow', () => {
  test('filters a seeded job, opens the detail, and updates local status', async ({
    isMobile,
    page,
    request,
  }) => {
    test.skip(isMobile, 'Jobs detail workflow is covered on the desktop layout.');

    const runId = uniqueRunId('job');

    try {
      await cleanupE2eData(runId);
      const scenario = await seedJobScenario(runId);

      await page.goto('/jobs');
      await expect(page.getByRole('heading', { name: 'Offerte' })).toBeVisible();

      await page.getByLabel('Testo').fill(scenario.title);
      const jobItem = page
        .locator('.job-list .list-group-item')
        .filter({ hasText: scenario.title });
      await expect(jobItem).toBeVisible();
      await expect(jobItem).toContainText('LinkedIn');
      await expect(jobItem).toContainText('Apply');

      await page.getByLabel('Modalita').selectOption('hybrid');
      await expect(jobItem).toBeVisible();
      await page.getByLabel('Modalita').selectOption('remote');
      await expect(jobItem).toBeHidden();
      await page.getByLabel('Modalita').selectOption('hybrid');
      await expect(jobItem).toBeVisible();

      await jobItem.click();
      const detail = page.locator('.col-xl-8 .card').filter({ hasText: scenario.title });
      await expect(detail).toContainText(scenario.title);
      await expect(detail).toContainText(`e2e-${runId}`);
      await expect(detail).toContainText('Stack TypeScript, Rust e PostgreSQL');

      await detail.getByRole('button', { name: 'Salvata' }).click();
      await expect(detail).toContainText('Salvata');
      await expect
        .poll(async () => {
          const response = await request.get(apiUrl(`/api/v1/jobs/${scenario.jobId}`));
          const body = await response.json();
          return body.data.localStatus;
        })
        .toBe('saved');

      await page.getByLabel('Stato locale').selectOption('saved');
      await expect(jobItem).toBeVisible();
      await page.getByRole('button', { name: 'Reset' }).click();
      await expect(jobItem).toBeVisible();
    } finally {
      await cleanupE2eData(runId);
    }
  });
});
