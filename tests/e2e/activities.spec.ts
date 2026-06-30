import { expect, test } from '@playwright/test';

import {
  apiUrl,
  cleanupE2eData,
  seedActivityQueueScenario,
  seedLinkedInDebugScenario,
  uniqueRunId,
  withDb,
} from './helpers';

// Pending refresh for the post-navbar UI: page headings were removed, the
// status/type filters moved into a "Filtri" dropdown, and the LinkedIn debug
// panel is gated behind debug mode. The queue-cancellation flow also mutates the
// global queue, so it must run against an isolated DB rather than the live stack.
test.describe.fixme('Activities workflow', () => {
  test('filters seeded activities and requests queue cancellation', async ({ isMobile, page }) => {
    test.skip(isMobile, 'Activities queue controls are covered on the desktop layout.');

    const runId = uniqueRunId('activity');

    try {
      await cleanupE2eData(runId);
      const scenario = await seedActivityQueueScenario(runId);

      await page.goto('/activities');
      await expect(page.getByRole('heading', { name: 'Attivita' })).toBeVisible();

      await page.getByLabel('Tipo attivita').selectOption('ai_review');
      await page.getByLabel('Stato attivita').selectOption('running');

      const activityList = page.locator('.activity-list');
      const aiActivity = activityList.locator('.list-group-item').filter({
        hasText: scenario.aiReviewMessage,
      });
      await expect(aiActivity).toBeVisible();
      await aiActivity.click();
      await page.getByRole('button', { exact: true, name: 'Annulla' }).click();
      await page.locator('.modal').getByRole('button', { name: 'Conferma' }).click();
      await expect
        .poll(async () =>
          withDb(async (client) => {
            const result = await client.query<{ cancel_requested: boolean }>(
              `
                SELECT cancel_requested_at IS NOT NULL AS cancel_requested
                FROM activities
                WHERE id = $1::uuid
              `,
              [scenario.aiReviewActivityId],
            );

            return result.rows[0]?.cancel_requested ?? false;
          }),
        )
        .toBe(true);

      await page.getByLabel('Tipo attivita').selectOption('dummy');
      await page.getByLabel('Stato attivita').selectOption('running');

      await expect(activityList).toContainText(scenario.dummyMessage);
      await expect(page.getByText(`E2E AI review activity ${runId}`)).toBeHidden();

      await page.getByRole('button', { name: 'Annulla coda' }).click();
      await page.locator('.modal').getByRole('button', { name: 'Annulla coda' }).click();

      await expect(page.getByText(/Coda aggiornata:/)).toBeVisible();
      await expect
        .poll(async () =>
          withDb(async (client) => {
            const result = await client.query<{ cancel_requested: boolean }>(
              `
                SELECT cancel_requested_at IS NOT NULL AS cancel_requested
                FROM activities
                WHERE id = $1::uuid
              `,
              [scenario.dummyActivityId],
            );

            return result.rows[0]?.cancel_requested ?? false;
          }),
        )
        .toBe(true);
    } finally {
      await cleanupE2eData(runId);
    }
  });

  test('shows a completed debug export artifact', async ({ isMobile, page, request }) => {
    test.skip(isMobile, 'Export artifact detail is covered on the desktop layout.');

    const runId = uniqueRunId('debug-export');
    let activityId: string | null = null;

    try {
      const response = await request.post(apiUrl('/api/v1/debug/bundle'));
      expect(response.ok()).toBeTruthy();
      activityId = ((await response.json()).data as { id: string }).id;

      await withDb(async (client) => {
        await client.query(
          `
            UPDATE activities
            SET payload = payload || $2::jsonb
            WHERE id = $1::uuid
          `,
          [activityId, JSON.stringify({ e2eRunId: runId })],
        );
      });

      await expect
        .poll(async () =>
          withDb(async (client) => {
            const result = await client.query<{
              artifact_kind: string | null;
              status: string;
            }>(
              `
                SELECT status, payload->'artifact'->>'kind' AS artifact_kind
                FROM activities
                WHERE id = $1::uuid
              `,
              [activityId],
            );
            const row = result.rows[0];
            return row ? `${row.status}:${row.artifact_kind ?? ''}` : '';
          }),
        )
        .toBe('success:debug_bundle');

      await page.goto('/activities');
      await expect(page.getByRole('heading', { name: 'Attivita' })).toBeVisible();
      await page.getByLabel('Tipo attivita').selectOption('export');
      await page.getByLabel('Stato attivita').selectOption('success');

      const exportActivity = page.locator('.activity-list .list-group-item').first();
      await expect(exportActivity).toBeVisible();
      await exportActivity.click();
      await expect(page.getByText('Artefatto')).toBeVisible();
      await expect(page.getByText('debug_bundle')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Scarica' })).toBeVisible();
    } finally {
      if (activityId) {
        await withDb(async (client) => {
          await client.query('DELETE FROM activity_logs WHERE activity_id = $1::uuid', [
            activityId,
          ]);
          await client.query('DELETE FROM activities WHERE id = $1::uuid', [activityId]);
        });
      }
      await cleanupE2eData(runId);
    }
  });

  test('shows sanitized LinkedIn raw payload debug for failed activities', async ({
    isMobile,
    page,
  }) => {
    test.skip(isMobile, 'LinkedIn debug detail is covered on the desktop layout.');

    const runId = uniqueRunId('linkedin-debug');

    try {
      await cleanupE2eData(runId);
      const scenario = await seedLinkedInDebugScenario(runId);

      await page.goto('/activities');
      await expect(page.getByRole('heading', { name: 'Attivita' })).toBeVisible();
      await page.getByLabel('Tipo attivita').selectOption('linkedin_collect');
      await page.getByLabel('Stato attivita').selectOption('failed');

      const activityList = page.locator('.activity-list');
      const failedActivity = activityList.locator('.list-group-item').filter({
        hasText: scenario.message,
      });
      await expect(failedActivity).toBeVisible();
      await failedActivity.click();

      await expect(page.getByText('Debug LinkedIn')).toBeVisible();
      await expect(page.locator('.badge').filter({ hasText: /^HTTP 500$/ })).toBeVisible();
      await expect(
        page.locator('.text-danger').filter({ hasText: 'LinkedIn fixture failure' }),
      ).toBeVisible();
      await expect(page.getByText('e2e-secret')).toHaveCount(0);
    } finally {
      await cleanupE2eData(runId);
    }
  });
});
