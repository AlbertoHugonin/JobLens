import { expect, test } from '@playwright/test';

import { cleanupE2eData, mockLinkedInGeoTypeahead, uniqueRunId, withDb } from './helpers';

test.describe('LinkedIn search workflow', () => {
  test('imports a public URL, previews it, saves the search, and deletes it', async ({
    isMobile,
    page,
  }) => {
    test.skip(isMobile, 'Search authoring workflow is covered on the desktop layout.');

    const runId = uniqueRunId('search');
    const searchName = `E2E LinkedIn ${runId}`;
    const linkedinUrl =
      'https://www.linkedin.com/jobs/search/?keywords=Cloud+Engineer' +
      '&location=Turin,+Piedmont,+Italy&geoId=106742401&distance=25&f_E=1,2' +
      '&position=1&pageNum=0';

    try {
      await cleanupE2eData(runId);
      await mockLinkedInGeoTypeahead(page);
      await page.goto('/searches');
      await expect(page.getByRole('heading', { name: 'Ricerche' })).toBeVisible();
      await expect(page.getByText('Caricamento ricerche')).toBeHidden();

      await page.getByRole('button', { name: 'Nuova' }).click();
      await expect(page.getByText('Wizard ricerca LinkedIn')).toBeVisible();
      await expect(page.getByLabel('Keyword')).toHaveValue('');
      await page.getByLabel('Importa URL LinkedIn').fill(linkedinUrl);
      await page.getByRole('button', { exact: true, name: 'Importa' }).click();
      await expect(page.getByLabel('Keyword')).toHaveValue('Cloud Engineer');
      await expect(page.getByLabel('geoId')).toHaveValue('106742401');

      await page.getByLabel('Nome ricerca').fill(searchName);
      await page.locator('#linkedin-workplace-2').check();
      await page.getByLabel('Scheduler automatico').check();
      await page.getByLabel('Intervallo minuti').fill('120');
      await page.getByLabel('Ritardo extra minuti').fill('10');
      await page.getByRole('checkbox', { name: 'Fascia inattiva' }).check();
      await page.getByLabel('Inizio fascia inattiva').fill('23:00');
      await page.getByLabel('Fine fascia inattiva').fill('06:00');
      await page.getByRole('button', { name: 'Preview URL' }).click();
      await expect(page.getByLabel('URL completo')).toHaveValue(/keywords=Cloud\+Engineer/);
      await expect(page.getByLabel('URL completo')).toHaveValue(/f_WT=2/);
      await page.getByRole('button', { exact: true, name: 'Salva' }).click();

      const savedSearch = page.locator('.list-group-item').filter({ hasText: searchName });
      await expect(savedSearch).toBeVisible();
      await expect(savedSearch).toContainText('attiva');
      await expect(savedSearch).toContainText('Cloud Engineer');
      await expect
        .poll(async () =>
          withDb(async (client) => {
            const result = await client.query<{
              schedule_config: {
                enabled?: boolean;
                extraDelayMinutes?: number;
                inactiveWindow?: { enabled?: boolean; endTime?: string; startTime?: string };
                intervalMinutes?: number;
              };
              query: {
                workplaceTypes?: string[];
              };
            }>(
              `
                SELECT query, schedule_config
                FROM searches
                WHERE name = $1
              `,
              [searchName],
            );
            const schedule = result.rows[0]?.schedule_config;
            const workplaceTypes = result.rows[0]?.query.workplaceTypes ?? [];
            return schedule
              ? [
                  schedule.enabled,
                  schedule.intervalMinutes,
                  schedule.extraDelayMinutes,
                  schedule.inactiveWindow?.enabled,
                  schedule.inactiveWindow?.startTime,
                  schedule.inactiveWindow?.endTime,
                  workplaceTypes.join(','),
                ].join(':')
              : '';
          }),
        )
        .toBe('true:120:10:true:23:00:06:00:2');

      await savedSearch.getByRole('button', { name: 'Elimina' }).click();
      await page.getByRole('button', { name: 'Conferma' }).click();
      await expect(savedSearch).toBeHidden();
    } finally {
      await cleanupE2eData(runId);
    }
  });
});
