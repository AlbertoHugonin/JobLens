import { describe, expect, it } from 'vitest';

import type { JobDetailDto, JobExportDto, JobSummaryDto } from '../API/jobs';
import {
  getJobAvailabilityStatusLabel,
  getJobLocalStatusLabel,
  type JobAvailabilityStatus,
  type JobLocalStatus,
} from '../models/job';
import {
  normalizeJobDetail,
  normalizeJobExport,
  normalizeJobInsights,
  normalizeJobList,
  normalizeJobReviewDetail,
} from './jobService';

const summaryDto: JobSummaryDto = {
  availabilityStatus: 'active',
  companyName: ' Acme ',
  createdAt: '2026-06-25T10:00:00.000Z',
  employmentType: ' Full-time ',
  externalJobs: [
    {
      externalId: ' m8-1 ',
      externalUrl: ' https://www.linkedin.com/jobs/view/m8-1 ',
      firstSeenAt: '2026-06-20T10:00:00.000Z',
      id: 'external-1',
      lastSeenAt: '2026-06-25T10:00:00.000Z',
      providerKey: 'linkedin',
      providerName: ' LinkedIn ',
    },
  ],
  id: 'job-1',
  latestReview: {
    createdAt: '2026-06-25T11:00:00.000Z',
    decision: 'apply',
    id: 'review-1',
    isPriority: true,
    modelName: ' m8-model ',
    priorityReason: 'priority_model',
    reviewMode: 'automatic',
    score: 91,
    status: 'success',
  },
  localStatus: 'new',
  locationText: ' Milan ',
  providerUrl: ' https://www.linkedin.com/jobs/view/m8-1 ',
  publishedAt: '2026-06-21T10:00:00.000Z',
  repostedAt: null,
  searches: [
    {
      firstSeenAt: '2026-06-20T10:00:00.000Z',
      lastActivityId: null,
      lastSeenAt: '2026-06-25T10:00:00.000Z',
      providerKey: 'linkedin',
      searchId: 'search-1',
      searchName: ' React Italy ',
    },
  ],
  seniority: null,
  sourceUrl: null,
  title: ' Frontend Engineer ',
  updatedAt: '2026-06-25T10:00:00.000Z',
  workplaceType: ' Remote ',
};

describe('jobService', () => {
  it('normalizes paginated job summaries', () => {
    const list = normalizeJobList([summaryDto], 3);
    const job = list.items[0];

    expect(list.total).toBe(3);
    expect(job).toMatchObject({
      companyName: 'Acme',
      employmentType: 'Full-time',
      localStatus: 'new',
      title: 'Frontend Engineer',
      workplaceType: 'Remote',
    });
    expect(job?.publishedAt?.toISOString()).toBe('2026-06-21T10:00:00.000Z');
    expect(job?.externalJobs[0]).toMatchObject({
      externalId: 'm8-1',
      providerName: 'LinkedIn',
    });
    expect(job?.latestReview).toMatchObject({
      decision: 'apply',
      modelName: 'm8-model',
      score: 91,
    });
  });

  it('normalizes detail and export payloads without requiring raw metadata', () => {
    const detailDto: JobDetailDto = {
      ...summaryDto,
      description: {
        fetchedAt: '2026-06-25T12:00:00.000Z',
        html: ' <p>Role description</p> ',
        htmlAvailable: true,
        id: 'description-1',
        source: ' provider ',
        text: ' Role description ',
      },
    };
    const exportDto: JobExportDto = {
      exportedAt: '2026-06-25T13:00:00.000Z',
      externalJobs: detailDto.externalJobs,
      job: {
        id: detailDto.id,
        title: detailDto.title,
      },
      latestDescription: detailDto.description,
      latestReview: detailDto.latestReview,
      searches: detailDto.searches,
    };

    const detail = normalizeJobDetail(detailDto);
    const exported = normalizeJobExport(exportDto);

    expect(detail.description).toMatchObject({
      html: '<p>Role description</p>',
      htmlAvailable: true,
      source: 'provider',
      text: 'Role description',
    });
    expect(exported.job).toEqual({
      id: 'job-1',
      title: ' Frontend Engineer ',
    });
    expect(JSON.stringify(exported)).not.toContain('rawCard');
  });

  it('exposes labels for UI state controls', () => {
    expect(getJobLocalStatusLabel('applied' satisfies JobLocalStatus)).toBe('Candidata');
    expect(getJobAvailabilityStatusLabel('active' satisfies JobAvailabilityStatus)).toBe('Attiva');
  });

  it('normalizes review details and AI insights', () => {
    const review = normalizeJobReviewDetail({
      ...summaryDto.latestReview!,
      endpointId: null,
      endpointName: ' Endpoint ',
      error: null,
      metrics: { ai: { durationMs: 1200 } },
      modelId: null,
      profileHash: 'profile-hash',
      rawOutput: '{"decision":"apply"}',
      result: { reason: 'strong fit' },
      rulesHash: 'rules-hash',
    });
    const insights = normalizeJobInsights({
      averageScore: 91.2,
      byDecision: [{ count: 1, key: 'apply' }],
      reviewed: 1,
      topMatches: [summaryDto],
      totalActive: 2,
      unreviewed: 1,
    });

    expect(review).toMatchObject({
      endpointName: 'Endpoint',
      isPriority: true,
      priorityReason: 'priority_model',
      result: { reason: 'strong fit' },
    });
    expect(insights.topMatches[0]?.latestReview?.score).toBe(91);
    expect(insights.byDecision).toEqual([{ count: 1, key: 'apply' }]);
  });
});
