import { expect, test } from '@playwright/test';

import {
  apiUrl,
  captureAiState,
  cleanupE2eData,
  restoreAiState,
  seedAiReviewScenario,
  uniqueRunId,
  withDb,
} from './helpers';

// Selectors are refreshed for the current UI, but this needs AI globally
// enabled so the worker claims the fixture review. Enabling AI against the
// shared dev DB would also churn the user's real review queue, so it only runs
// safely in an isolated DB (CI) — kept as fixme until that harness exists.
test.describe.fixme('AI review workflow', () => {
  test('processes an AI review through a fixture and shows it on the job detail', async ({
    isMobile,
    page,
    request,
  }) => {
    test.skip(isMobile, 'AI review detail workflow is covered on the desktop layout.');

    const runId = uniqueRunId('ai-review');
    const snapshot = await captureAiState(request);

    try {
      await cleanupE2eData(runId);
      const scenario = await seedAiReviewScenario(runId);

      // The worker picks up the queued fixture review and writes the result.
      await expect
        .poll(
          async () =>
            withDb(async (client) => {
              const result = await client.query<{
                decision: string | null;
                retry_attempt: string | null;
                score: number | null;
                status: string;
              }>(
                `
                SELECT
                  activities.status,
                  latest_review.decision,
                  latest_review.score,
                  latest_review.metrics->'ai'->>'retryAttempt' AS retry_attempt
                FROM activities
                LEFT JOIN LATERAL (
                  SELECT decision, score, metrics
                  FROM job_reviews
                  WHERE job_reviews.job_id = $2::uuid
                  ORDER BY created_at DESC
                  LIMIT 1
                ) latest_review ON true
                WHERE activities.id = $1::uuid
              `,
                [scenario.activityId, scenario.jobId],
              );
              const row = result.rows[0];
              return row
                ? `${row.status}:${row.decision ?? ''}:${row.score ?? ''}:${row.retry_attempt ?? ''}`
                : '';
            }),
          { timeout: 20_000 },
        )
        .toBe('success:apply:88:2');

      const response = await request.get(apiUrl(`/api/v1/jobs/${scenario.jobId}`));
      expect(response.ok()).toBeTruthy();
      const detail = (await response.json()).data;
      expect(detail.latestReview).toMatchObject({
        decision: 'apply',
        score: 88,
      });

      await page.goto('/jobs');
      await expect(page.getByRole('textbox', { name: 'Cerca offerte' })).toBeVisible();
      await page.getByRole('textbox', { name: 'Cerca offerte' }).fill(scenario.title);

      const jobItem = page
        .locator('.job-list .list-group-item')
        .filter({ hasText: scenario.title });
      await expect(jobItem).toBeVisible();

      await jobItem.click();
      const detailCard = page.locator('.job-detail-card');
      await expect(detailCard).toContainText(scenario.title);
      // The AI review panel renders the decision badge and the score.
      await expect(detailCard).toContainText('Apply');
      await expect(detailCard).toContainText('88');
    } finally {
      await restoreAiState(request, snapshot);
      await cleanupE2eData(runId);
    }
  });
});
