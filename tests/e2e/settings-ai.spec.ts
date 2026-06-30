import { expect, test } from '@playwright/test';

import { apiUrl, captureAiState, cleanupE2eData, restoreAiState, uniqueRunId } from './helpers';

// Pending refresh: the AI settings UI now probes the server before adding an
// endpoint and exposes installed models as dropdowns, so this flow needs a
// reachable AI server (Ollama) and cannot run headlessly. Page headings were
// also removed. Re-enable once a mocked-Ollama harness exists.
test.describe.fixme('AI settings workflow', () => {
  test('creates and activates an endpoint, queues a model install, and saves runtime/profile', async ({
    isMobile,
    page,
    request,
  }) => {
    test.skip(isMobile, 'AI settings workflow is covered on the desktop layout.');

    const runId = uniqueRunId('ai');
    const snapshot = await captureAiState(request);
    const endpointName = `E2E AI ${runId}`;
    const endpointUrl = `http://127.0.0.1:${18_000 + Math.floor(Math.random() * 1000)}/${runId}`;
    const modelName = `e2e-model-${runId}`;
    const candidateProfile = `Profilo candidato E2E ${runId}`;
    const evaluationRules = `Regole valutazione E2E ${runId}\n- apply se il match e forte.`;

    try {
      await cleanupE2eData(runId);
      await page.goto('/settings');
      await expect(page.getByRole('heading', { name: 'Impostazioni' })).toBeVisible();

      await page.getByLabel('Nome endpoint').fill(endpointName);
      await page.getByLabel('Base URL').fill(endpointUrl);
      await page.getByRole('button', { name: 'Aggiungi endpoint' }).click();

      const endpointItem = page.locator('.list-group-item').filter({ hasText: endpointName });
      await expect(endpointItem).toContainText('Disponibile');
      await endpointItem.getByRole('button', { name: 'Attiva' }).click();
      await expect(endpointItem).toContainText('Attivo');

      await page.getByLabel('Nome modello').fill(modelName);
      await page.getByRole('button', { name: 'Installa modello' }).click();
      await expect(page.locator('.list-group-item').filter({ hasText: modelName })).toBeVisible();

      await page.locator('#ai-enabled').setChecked(true);
      await page.getByLabel('Modello valutazioni').fill(modelName);
      await page.getByLabel('Modello prioritario').fill(modelName);
      await page.getByLabel('Timeout sec').fill('45');
      await page.getByLabel('num_ctx').fill('4096');
      await page.getByLabel('num_predict').fill('512');
      await page.getByLabel('temperature').fill('0.4');
      await page.getByLabel('keep_alive').fill('5m');
      await page.getByLabel('Retry', { exact: true }).fill('2');
      await page.getByLabel('Ritardo retry sec').fill('15');
      await page.getByLabel('Giorno pausa AI').selectOption('5');
      await page.getByLabel('Inizio pausa AI').fill('09:00');
      await page.getByLabel('Fine pausa AI').fill('10:30');
      await page.getByRole('button', { exact: true, name: 'Aggiungi' }).click();
      await expect(page.getByText('Venerdi 09:00-10:30')).toBeVisible();
      await page.getByRole('button', { name: 'Salva runtime e pause' }).click();
      await expect(page.getByText('Abilitata')).toBeVisible();
      await expect
        .poll(async () => {
          const response = await request.get(apiUrl('/api/v1/ai/settings'));
          const body = await response.json();
          return body.data.runtime;
        })
        .toMatchObject({
          keepAlive: '5m',
          modelName,
          numCtx: 4096,
          numPredict: 512,
          priorityModelName: modelName,
          retryAttempts: 2,
          retryDelaySeconds: 15,
          temperature: 0.4,
          timeoutSeconds: 45,
        });

      const profilePanel = page.locator('.card').filter({ hasText: 'Profilo e regole' });
      await profilePanel.getByLabel('Profilo candidato').fill(candidateProfile);
      await profilePanel.getByLabel('Regole di valutazione').fill(evaluationRules);
      await expect(profilePanel.getByLabel('Profilo candidato')).toHaveValue(candidateProfile);
      await expect(profilePanel.getByLabel('Regole di valutazione')).toHaveValue(evaluationRules);
      await profilePanel.getByRole('button', { name: 'Salva profilo e regole' }).click();

      await expect
        .poll(async () => {
          const response = await request.get(apiUrl('/api/v1/ai/settings'));
          const body = await response.json();
          return body.data;
        })
        .toMatchObject({
          candidateProfile,
          enabled: true,
          evaluationRules,
          runtime: {
            keepAlive: '5m',
            modelName,
            numCtx: 4096,
            numPredict: 512,
            priorityModelName: modelName,
            retryAttempts: 2,
            retryDelaySeconds: 15,
            temperature: 0.4,
            timeoutSeconds: 45,
          },
        });
    } finally {
      await restoreAiState(request, snapshot);
      await cleanupE2eData(runId);
    }
  });
});
