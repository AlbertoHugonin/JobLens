import type {
  BatchJobReviewsDto,
  JobDescriptionDto,
  JobDetailDto,
  JobExportDto,
  JobExternalDto,
  JobInsightsDto,
  JobReviewDetailDto,
  JobReviewSummaryDto,
  JobSearchPresenceDto,
  JobSummaryDto,
} from '../API/jobs';
import type {
  BatchJobReviewResult,
  JobDescription,
  JobDetail,
  JobExport,
  JobExternal,
  JobInsights,
  JobList,
  JobReviewDetail,
  JobReviewSummary,
  JobSearchPresence,
  JobSummary,
} from '../models/job';
import { normalizeActivity } from './activityService';

function normalizeDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function normalizeNullableDate(value: string | null): Date | null {
  return value ? normalizeDate(value) : null;
}

function normalizeOptionalString(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function normalizeJobExternal(dto: JobExternalDto): JobExternal {
  return {
    externalId: dto.externalId.trim(),
    externalUrl: normalizeOptionalString(dto.externalUrl),
    firstSeenAt: normalizeDate(dto.firstSeenAt),
    id: dto.id,
    lastSeenAt: normalizeDate(dto.lastSeenAt),
    providerKey: dto.providerKey.trim(),
    providerName: dto.providerName.trim() || dto.providerKey,
  };
}

export function normalizeJobSearchPresence(dto: JobSearchPresenceDto): JobSearchPresence {
  return {
    firstSeenAt: normalizeDate(dto.firstSeenAt),
    lastActivityId: normalizeOptionalString(dto.lastActivityId),
    lastSeenAt: normalizeDate(dto.lastSeenAt),
    providerKey: dto.providerKey.trim(),
    searchId: dto.searchId,
    searchName: dto.searchName.trim() || 'Ricerca',
  };
}

export function normalizeJobReview(dto: JobReviewSummaryDto | null): JobReviewSummary | null {
  if (!dto) {
    return null;
  }

  return {
    createdAt: normalizeDate(dto.createdAt),
    decision: dto.decision,
    id: dto.id,
    isPriority: dto.isPriority,
    modelName: dto.modelName.trim() || 'Modello',
    priorityReason: dto.priorityReason.trim() || 'latest_review',
    reviewMode: dto.reviewMode?.trim() || null,
    score: Number.isFinite(dto.score) ? dto.score : null,
    status: dto.status,
  };
}

export function normalizeJobReviewDetail(dto: JobReviewDetailDto): JobReviewDetail {
  const summary = normalizeJobReview(dto);

  return {
    ...(summary ?? {
      createdAt: new Date(0),
      decision: null,
      id: dto.id,
      isPriority: false,
      modelName: 'Modello',
      priorityReason: 'latest_review',
      reviewMode: null,
      score: null,
      status: dto.status,
    }),
    endpointId: normalizeOptionalString(dto.endpointId),
    endpointName: normalizeOptionalString(dto.endpointName),
    error: normalizeOptionalString(dto.error),
    metrics: dto.metrics,
    modelId: normalizeOptionalString(dto.modelId),
    profileHash: dto.profileHash.trim(),
    rawOutput: normalizeOptionalString(dto.rawOutput),
    result: dto.result,
    rulesHash: dto.rulesHash.trim(),
  };
}

export function normalizeJobDescription(dto: JobDescriptionDto | null): JobDescription | null {
  if (!dto) {
    return null;
  }

  return {
    fetchedAt: normalizeDate(dto.fetchedAt),
    html: normalizeOptionalString(dto.html),
    htmlAvailable: dto.htmlAvailable,
    id: dto.id,
    source: dto.source.trim() || 'provider',
    text: dto.text.trim(),
  };
}

export function normalizeJobSummary(dto: JobSummaryDto): JobSummary {
  return {
    availabilityStatus: dto.availabilityStatus,
    companyName: dto.companyName.trim() || 'Azienda sconosciuta',
    createdAt: normalizeDate(dto.createdAt),
    employmentType: normalizeOptionalString(dto.employmentType),
    externalJobs: dto.externalJobs.map(normalizeJobExternal),
    id: dto.id,
    latestReview: normalizeJobReview(dto.latestReview),
    localStatus: dto.localStatus,
    locationText: normalizeOptionalString(dto.locationText),
    providerUrl: normalizeOptionalString(dto.providerUrl),
    publishedAt: normalizeNullableDate(dto.publishedAt),
    repostedAt: normalizeNullableDate(dto.repostedAt),
    searches: dto.searches.map(normalizeJobSearchPresence),
    seniority: normalizeOptionalString(dto.seniority),
    sourceUrl: normalizeOptionalString(dto.sourceUrl),
    title: dto.title.trim() || 'Offerta senza titolo',
    updatedAt: normalizeDate(dto.updatedAt),
    workplaceType: normalizeOptionalString(dto.workplaceType),
  };
}

export function normalizeJobDetail(dto: JobDetailDto): JobDetail {
  return {
    ...normalizeJobSummary(dto),
    description: normalizeJobDescription(dto.description),
  };
}

export function normalizeJobList(items: JobSummaryDto[], total: number): JobList {
  return {
    items: items.map(normalizeJobSummary),
    total: Number.isFinite(total) ? total : items.length,
  };
}

export function normalizeJobExport(dto: JobExportDto): JobExport {
  return {
    exportedAt: normalizeDate(dto.exportedAt),
    externalJobs: dto.externalJobs.map(normalizeJobExternal),
    job: dto.job,
    latestDescription: normalizeJobDescription(dto.latestDescription),
    latestReview: normalizeJobReview(dto.latestReview),
    reviews: dto.reviews.map(normalizeJobReviewDetail),
    searches: dto.searches.map(normalizeJobSearchPresence),
  };
}

export function normalizeBatchJobReviewResult(dto: BatchJobReviewsDto): BatchJobReviewResult {
  return {
    queued: dto.queued.map(normalizeActivity),
    skipped: dto.skipped.map((item) => ({
      jobId: item.jobId,
      reason: item.reason.trim() || 'skipped',
    })),
  };
}

export function normalizeJobInsights(dto: JobInsightsDto): JobInsights {
  return {
    averageScore: Number.isFinite(dto.averageScore) ? dto.averageScore : null,
    byDecision: dto.byDecision.map((item) => ({
      count: Number.isFinite(item.count) ? item.count : 0,
      key: item.key,
    })),
    reviewed: Number.isFinite(dto.reviewed) ? dto.reviewed : 0,
    topMatches: dto.topMatches.map(normalizeJobSummary),
    totalActive: Number.isFinite(dto.totalActive) ? dto.totalActive : 0,
    unreviewed: Number.isFinite(dto.unreviewed) ? dto.unreviewed : 0,
  };
}
