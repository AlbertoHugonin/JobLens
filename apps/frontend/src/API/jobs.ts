import { apiRequest, type ApiSuccessDto, type PaginationMetaDto } from './client';
import type { ActivityDto } from './activities';

export type JobAvailabilityStatusDto =
  | 'active'
  | 'available_outside_searches'
  | 'missing_from_searches'
  | 'unavailable';

export type JobLocalStatusDto = 'applied' | 'new' | 'saved' | 'viewed';
export type JobReviewDecisionDto = 'apply' | 'maybe' | 'reject';
export type JobReviewModeDto = 'automatic' | 'benchmark' | 'manual';
export type JobScopeDto = 'all' | 'standard';
export type JobSortByDto = 'aiScore' | 'publishedAt' | 'repostedAt';
export type JobSortDirDto = 'asc' | 'desc';
export type JobWorkplaceModeDto = 'hybrid' | 'onsite' | 'remote';

export interface JobExternalDto {
  externalId: string;
  externalUrl: string | null;
  firstSeenAt: string;
  id: string;
  lastSeenAt: string;
  providerKey: string;
  providerName: string;
}

export interface JobSearchPresenceDto {
  firstSeenAt: string;
  lastActivityId: string | null;
  lastSeenAt: string;
  providerKey: string;
  searchId: string;
  searchName: string;
}

export interface JobReviewSummaryDto {
  createdAt: string;
  decision: JobReviewDecisionDto | null;
  id: string;
  isPriority: boolean;
  modelName: string;
  priorityReason: string;
  reviewMode: string | null;
  score: number | null;
  status: 'failed' | 'success';
}

export interface JobReviewDetailDto extends JobReviewSummaryDto {
  endpointId: string | null;
  endpointName: string | null;
  error: string | null;
  metrics: Record<string, unknown>;
  modelId: string | null;
  profileHash: string;
  rawOutput: string | null;
  result: Record<string, unknown>;
  rulesHash: string;
}

export interface JobDescriptionDto {
  fetchedAt: string;
  html: string | null;
  htmlAvailable: boolean;
  id: string;
  source: string;
  text: string;
}

export interface JobSummaryDto {
  availabilityStatus: JobAvailabilityStatusDto;
  companyName: string;
  createdAt: string;
  employmentType: string | null;
  externalJobs: JobExternalDto[];
  id: string;
  latestReview: JobReviewSummaryDto | null;
  localStatus: JobLocalStatusDto;
  locationText: string | null;
  providerUrl: string | null;
  publishedAt: string | null;
  repostedAt: string | null;
  searches: JobSearchPresenceDto[];
  seniority: string | null;
  sourceUrl: string | null;
  title: string;
  updatedAt: string;
  workplaceType: string | null;
}

export interface JobDetailDto extends JobSummaryDto {
  description: JobDescriptionDto | null;
}

export interface JobExportDto {
  exportedAt: string;
  externalJobs: JobExternalDto[];
  job: Record<string, unknown>;
  latestDescription: JobDescriptionDto | null;
  latestReview: JobReviewSummaryDto | null;
  reviews: JobReviewDetailDto[];
  searches: JobSearchPresenceDto[];
}

export interface JobDecisionCountDto {
  count: number;
  key: JobReviewDecisionDto | 'none';
}

export interface JobInsightsDto {
  averageScore: number | null;
  byDecision: JobDecisionCountDto[];
  reviewed: number;
  topMatches: JobSummaryDto[];
  totalActive: number;
  unreviewed: number;
}

export interface JobListParams {
  availabilityStatus?: JobAvailabilityStatusDto | undefined;
  // Comma-separated decisions (e.g. "apply,maybe").
  decision?: string | undefined;
  limit?: number | undefined;
  localStatus?: JobLocalStatusDto | undefined;
  location?: string | undefined;
  modelName?: string | undefined;
  offset?: number | undefined;
  providerKey?: 'linkedin' | undefined;
  scope?: JobScopeDto | undefined;
  searchId?: string | undefined;
  sortBy?: JobSortByDto | undefined;
  sortDir?: JobSortDirDto | undefined;
  text?: string | undefined;
  workplace?: JobWorkplaceModeDto | undefined;
}

export interface JobStateInput {
  localStatus: JobLocalStatusDto;
}

export interface JobReviewInput {
  endpointId?: string | undefined;
  force?: boolean | undefined;
  mode?: JobReviewModeDto | undefined;
  modelName?: string | undefined;
}

export interface BatchJobReviewsInput extends JobReviewInput {
  filters?: Omit<JobListParams, 'limit' | 'offset'> | undefined;
  jobIds?: string[] | undefined;
}

export interface SkippedJobReviewDto {
  jobId: string;
  reason: string;
}

export interface BatchJobReviewsDto {
  queued: ActivityDto[];
  skipped: SkippedJobReviewDto[];
}

function assignQueryValue(
  query: Record<string, number | string>,
  key: string,
  value: number | string | undefined,
): void {
  if (value !== undefined && value !== '') {
    query[key] = value;
  }
}

export function fetchJobs(
  params: JobListParams = {},
): Promise<ApiSuccessDto<JobSummaryDto[], PaginationMetaDto>> {
  const query: Record<string, number | string> = {};

  assignQueryValue(query, 'availabilityStatus', params.availabilityStatus);
  assignQueryValue(query, 'decision', params.decision);
  assignQueryValue(query, 'limit', params.limit);
  assignQueryValue(query, 'localStatus', params.localStatus);
  assignQueryValue(query, 'location', params.location);
  assignQueryValue(query, 'modelName', params.modelName);
  assignQueryValue(query, 'offset', params.offset);
  assignQueryValue(query, 'providerKey', params.providerKey);
  assignQueryValue(query, 'scope', params.scope);
  assignQueryValue(query, 'searchId', params.searchId);
  assignQueryValue(query, 'sortBy', params.sortBy);
  assignQueryValue(query, 'sortDir', params.sortDir);
  assignQueryValue(query, 'text', params.text);
  assignQueryValue(query, 'workplace', params.workplace);

  return apiRequest<ApiSuccessDto<JobSummaryDto[], PaginationMetaDto>>('/api/v1/jobs', {}, query);
}

export function fetchJob(id: string): Promise<ApiSuccessDto<JobDetailDto>> {
  return apiRequest<ApiSuccessDto<JobDetailDto>>(`/api/v1/jobs/${id}`);
}

export function fetchJobInsights(topLimit = 5): Promise<ApiSuccessDto<JobInsightsDto>> {
  return apiRequest<ApiSuccessDto<JobInsightsDto>>('/api/v1/jobs/insights', {}, { topLimit });
}

export function fetchJobReviews(id: string): Promise<ApiSuccessDto<JobReviewDetailDto[]>> {
  return apiRequest<ApiSuccessDto<JobReviewDetailDto[]>>(`/api/v1/jobs/${id}/reviews`);
}

export function updateJobState(
  id: string,
  input: JobStateInput,
): Promise<ApiSuccessDto<JobDetailDto>> {
  return apiRequest<ApiSuccessDto<JobDetailDto>>(`/api/v1/jobs/${id}/state`, {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  });
}

export function requestJobReview(
  id: string,
  input: JobReviewInput = {},
): Promise<ApiSuccessDto<ActivityDto>> {
  return apiRequest<ApiSuccessDto<ActivityDto>>(`/api/v1/jobs/${id}/reviews`, {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function requestBatchJobReviews(
  input: BatchJobReviewsInput,
): Promise<ApiSuccessDto<BatchJobReviewsDto>> {
  return apiRequest<ApiSuccessDto<BatchJobReviewsDto>>('/api/v1/jobs/batch-reviews', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function exportJob(id: string): Promise<ApiSuccessDto<JobExportDto>> {
  return apiRequest<ApiSuccessDto<JobExportDto>>(`/api/v1/jobs/${id}/export`);
}
