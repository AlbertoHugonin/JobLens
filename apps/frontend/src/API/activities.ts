import { apiRequest, type ApiSuccessDto, type PaginationMetaDto } from './client';

export type ActivityStatusDto =
  | 'cancelled'
  | 'failed'
  | 'interrupted'
  | 'queued'
  | 'running'
  | 'success';

export interface ActivityDto {
  activityType: string;
  attempt: number;
  cancelRequestedAt: string | null;
  createdAt: string;
  error: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  id: string;
  leaseExpiresAt: string | null;
  leaseOwner: string | null;
  maxAttempts: number;
  message: string | null;
  payload: unknown;
  phase: string | null;
  progressCurrent: number;
  progressTotal: number | null;
  queuedAt: string;
  source: string;
  startedAt: string | null;
  status: ActivityStatusDto;
  subjectId: string | null;
  subjectType: string | null;
  updatedAt: string;
}

export interface ActivityLogDto {
  activityId: string;
  createdAt: string;
  data: unknown;
  id: string;
  level: 'debug' | 'error' | 'info' | 'warn';
  message: string;
}

export interface ActivityCountDto {
  count: number;
  key: string;
}

export interface ActivitySummaryDto {
  active: ActivityDto[];
  byStatus: ActivityCountDto[];
  byType: ActivityCountDto[];
  total: number;
}

export interface ActivityQueueCancellationDto {
  cancelled: number;
  items: ActivityDto[];
  requested: number;
  total: number;
}

export interface LinkedInRawPayloadDebugDto {
  contentType: string | null;
  createdAt: string;
  elapsedMs: number | null;
  error: string | null;
  id: string;
  payloadKind: 'empty' | 'json' | 'text';
  requestParams: unknown;
  requestUrl: string | null;
  responseStatus: number | null;
  snippet: string | null;
}

export interface LinkedInRawPayloadStatusCountDto {
  count: number;
  status: string;
}

export interface LinkedInActivityDebugDto {
  activityId: string;
  activityType: string;
  failed: number;
  items: LinkedInRawPayloadDebugDto[];
  latestStatus: number | null;
  providerKey: 'linkedin';
  statusCounts: LinkedInRawPayloadStatusCountDto[];
  total: number;
}

export interface ActivityListParams {
  limit?: number | undefined;
  offset?: number | undefined;
  status?: ActivityStatusDto | undefined;
  subjectId?: string | undefined;
  subjectType?: string | undefined;
  type?: string | undefined;
}

export interface ActivityLogListParams {
  limit?: number | undefined;
  offset?: number | undefined;
}

export interface CreateActivityInput {
  payload?: unknown | undefined;
  type: 'dummy';
}

export interface CancelActivityQueueInput {
  source?: string | undefined;
  type?: string | undefined;
}

export function fetchActivities(
  params: ActivityListParams = {},
): Promise<ApiSuccessDto<ActivityDto[], PaginationMetaDto>> {
  const query: Record<string, number | string> = {};

  if (params.limit !== undefined) {
    query.limit = params.limit;
  }

  if (params.offset !== undefined) {
    query.offset = params.offset;
  }

  if (params.status !== undefined) {
    query.status = params.status;
  }

  if (params.subjectId !== undefined) {
    query.subjectId = params.subjectId;
  }

  if (params.subjectType !== undefined) {
    query.subjectType = params.subjectType;
  }

  if (params.type !== undefined) {
    query.type = params.type;
  }

  return apiRequest<ApiSuccessDto<ActivityDto[], PaginationMetaDto>>(
    '/api/v1/activities',
    {},
    query,
  );
}

export function fetchActivity(id: string): Promise<ApiSuccessDto<ActivityDto>> {
  return apiRequest<ApiSuccessDto<ActivityDto>>(`/api/v1/activities/${id}`);
}

export function fetchActivitySummary(activeLimit = 5): Promise<ApiSuccessDto<ActivitySummaryDto>> {
  return apiRequest<ApiSuccessDto<ActivitySummaryDto>>(
    '/api/v1/activities/summary',
    {},
    { activeLimit },
  );
}

export function fetchActivityLogs(
  id: string,
  params: ActivityLogListParams = {},
): Promise<ApiSuccessDto<ActivityLogDto[], PaginationMetaDto>> {
  const query: Record<string, number> = {};

  if (params.limit !== undefined) {
    query.limit = params.limit;
  }

  if (params.offset !== undefined) {
    query.offset = params.offset;
  }

  return apiRequest<ApiSuccessDto<ActivityLogDto[], PaginationMetaDto>>(
    `/api/v1/activities/${id}/logs`,
    {},
    query,
  );
}

export function fetchActivityLinkedInDebug(
  id: string,
  limit = 20,
): Promise<ApiSuccessDto<LinkedInActivityDebugDto>> {
  return apiRequest<ApiSuccessDto<LinkedInActivityDebugDto>>(
    `/api/v1/activities/${id}/linkedin-debug`,
    {},
    { limit },
  );
}

export function createActivity(input: CreateActivityInput): Promise<ApiSuccessDto<ActivityDto>> {
  return apiRequest<ApiSuccessDto<ActivityDto>>('/api/v1/activities', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function cancelActivity(id: string): Promise<ApiSuccessDto<ActivityDto>> {
  return apiRequest<ApiSuccessDto<ActivityDto>>(`/api/v1/activities/${id}/cancel`, {
    method: 'POST',
  });
}

export function cancelActivityQueue(
  input: CancelActivityQueueInput = {},
): Promise<ApiSuccessDto<ActivityQueueCancellationDto>> {
  return apiRequest<ApiSuccessDto<ActivityQueueCancellationDto>>('/api/v1/activities/cancel', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function retryActivity(id: string): Promise<ApiSuccessDto<ActivityDto>> {
  return apiRequest<ApiSuccessDto<ActivityDto>>(`/api/v1/activities/${id}/retry`, {
    method: 'POST',
  });
}
