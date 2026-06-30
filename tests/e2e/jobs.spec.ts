import { expect, test } from '@playwright/test';

import { apiUrl, cleanupE2eData, seedJobScenario, uniqueRunId } from './helpers';

test.describe('Jobs workflow', () => {
  test('shows a seeded offer by default, opens the detail, and updates local status', async ({
    isMobile,
    page,
    request,
  }) => {
    test.skip(isMobile, 'Job detail workflow is covered on the desktop layout.');

    const runId = uniqueRunId('job');

    try {
      await cleanupE2eData(runId);
      const scenario = await seedJobScenario(runId);

      await page.goto('/jobs');
      await expect(page.getByRole('textbox', { name: 'Cerca offerte' })).toBeVisible();

      // The default filter no longer narrows by AI decision, so a freshly seeded
      // offer is visible without any review-based filtering.
      await page.getByRole('textbox', { name: 'Cerca offerte' }).fill(scenario.title);
      const jobItem = page
        .locator('.job-list .list-group-item')
        .filter({ hasText: scenario.title });
      await expect(jobItem).toBeVisible();

      await jobItem.click();
      const detail = page.locator('.job-detail-card');
      await expect(detail).toContainText(scenario.title);
      await expect(detail).toContainText(`e2e-${runId}`);
      await expect(detail).toContainText('Stack TypeScript, Rust e PostgreSQL');

      await detail.getByLabel('Stato locale').selectOption('saved');
      await expect
        .poll(async () => {
          const response = await request.get(apiUrl(`/api/v1/jobs/${scenario.jobId}`));
          const body = await response.json();
          return body.data.localStatus;
        })
        .toBe('saved');
    } finally {
      await cleanupE2eData(runId);
    }
  });
});
