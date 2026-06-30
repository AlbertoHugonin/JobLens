import { describe, expect, it } from 'vitest';

import {
  createDefaultSearchScheduleConfig,
  createDraftFromSearch,
  createDuplicateDraftFromSearch,
} from '../models/search';
import {
  draftToLinkedInQueryInput,
  normalizeProviderSession,
  normalizeSearch,
  normalizeSearchPreview,
  validateLinkedInSearchDraft,
} from './searchService';

describe('searchService', () => {
  it('normalizes LinkedIn searches and creates editable drafts', () => {
    const search = normalizeSearch({
      createdAt: '2026-06-25T00:00:00.000Z',
      enabled: true,
      id: 'search-1',
      lastRunAt: null,
      name: ' React Italy ',
      providerKey: 'linkedin',
      providerName: 'LinkedIn',
      query: {
        currentJobId: null,
        distance: '25',
        exactMatch: true,
        experienceLevels: ['1', '2', '3'],
        geoId: '103350119',
        keywords: ' React Developer ',
        location: ' Italy ',
        preservedParams: {},
        providerKey: 'linkedin',
        publicUrl:
          'https://www.linkedin.com/jobs/search/?keywords=%22React+Developer%22&location=Italy&geoId=103350119&distance=25&f_E=1,2,3&f_WT=2&position=1&pageNum=0',
        unsupportedParams: {},
        workplaceTypes: ['2'],
      },
      scheduleConfig: {},
      updatedAt: '2026-06-25T00:00:01.000Z',
    });
    const draft = createDraftFromSearch(search);
    const duplicateDraft = createDuplicateDraftFromSearch(search);

    expect(search.name).toBe('React Italy');
    expect(search.query.keywords).toBe('React Developer');
    expect(draft).toMatchObject({
      exactMatch: true,
      geoId: '103350119',
      name: 'React Italy',
    });
    expect(draftToLinkedInQueryInput(draft)).toMatchObject({
      exactMatch: true,
      experienceLevels: ['1', '2', '3'],
      geoId: '103350119',
      keywords: 'React Developer',
      location: 'Italy',
      workplaceTypes: ['2'],
    });
    expect(duplicateDraft).toMatchObject({
      ...draft,
      name: 'Copia di React Italy',
    });
  });

  it('validates required wizard fields', () => {
    expect(
      validateLinkedInSearchDraft({
        distance: '25',
        enabled: true,
        exactMatch: false,
        experienceLevels: ['1'],
        geoId: '',
        keywords: '',
        location: '',
        name: '',
        scheduleConfig: createDefaultSearchScheduleConfig(),
        workplaceTypes: [],
      }),
    ).toBe('Il nome ricerca e obbligatorio');
  });

  it('normalizes preview and session summaries without exposing secrets', () => {
    const preview = normalizeSearchPreview({
      providerKey: 'linkedin',
      query: {
        currentJobId: null,
        distance: '10',
        exactMatch: false,
        experienceLevels: ['2'],
        geoId: '900',
        keywords: 'TypeScript',
        location: 'Milan',
        preservedParams: {},
        providerKey: 'linkedin',
        publicUrl: 'https://www.linkedin.com/jobs/search/?keywords=TypeScript',
        unsupportedParams: {},
        workplaceTypes: ['3'],
      },
      url: 'https://www.linkedin.com/jobs/search/?keywords=TypeScript',
    });
    const session = normalizeProviderSession({
      createdAt: '2026-06-25T00:00:00.000Z',
      id: 'session-1',
      label: ' LinkedIn ',
      lastVerifiedAt: null,
      providerKey: 'linkedin',
      providerName: 'LinkedIn',
      status: 'active',
      summary: {
        acceptLanguage: 'en-US',
        decorationId: 'decoration',
        hasJsessionid: true,
        hasLiAt: true,
        hasXLiTrack: false,
        importedAt: '2026-06-25T00:00:00.000Z',
        jobCardRequestCount: 1,
        source: 'manual',
        userAgent: 'Browser',
        xLiLang: 'en_US',
      },
      updatedAt: '2026-06-25T00:00:00.000Z',
    });

    expect(preview.query.publicUrl).toContain('TypeScript');
    expect(session.summary).toMatchObject({
      hasJsessionid: true,
      hasLiAt: true,
      source: 'manual',
    });
    expect(JSON.stringify(session)).not.toContain('li_at');
  });
});
