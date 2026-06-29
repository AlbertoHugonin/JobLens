import type {
  ActivityDto,
  ActivityLogDto,
  ActivityQueueCancellationDto,
  ActivityStatusDto,
  ActivitySummaryDto,
  LinkedInActivityDebugDto,
  LinkedInRawPayloadDebugDto,
} from '../API/activities';
import type {
  Activity,
  ActivityCount,
  ActivityDashboardSummary,
  ActivityList,
  ActivityLog,
  ActivityPreview,
  ActivityQueueCancellationResult,
  ActivityStatus,
  LinkedInActivityDebug,
  LinkedInRawPayloadDebug,
} from '../models/activity';

function normalizeStatus(status: ActivityStatusDto): ActivityStatus {
  return status;
}

function normalizeDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function normalizeNullableDate(value: string | null): Date | null {
  return value ? normalizeDate(value) : null;
}

export function normalizeActivity(dto: ActivityDto): Activity {
  return {
    activityType: dto.activityType.trim() || 'unknown',
    attempt: Number.isFinite(dto.attempt) ? dto.attempt : 0,
    cancelRequestedAt: normalizeNullableDate(dto.cancelRequestedAt),
    createdAt: normalizeDate(dto.createdAt),
    error: dto.error?.trim() || null,
    finishedAt: normalizeNullableDate(dto.finishedAt),
    heartbeatAt: normalizeNullableDate(dto.heartbeatAt),
    id: dto.id,
    leaseExpiresAt: normalizeNullableDate(dto.leaseExpiresAt),
    leaseOwner: dto.leaseOwner?.trim() || null,
    maxAttempts: Number.isFinite(dto.maxAttempts) ? dto.maxAttempts : 1,
    message: dto.message?.trim() || null,
    payload: dto.payload,
    phase: dto.phase?.trim() || null,
    progressCurrent: Number.isFinite(dto.progressCurrent) ? dto.progressCurrent : 0,
    progressTotal:
      dto.progressTotal !== null && Number.isFinite(dto.progressTotal) ? dto.progressTotal : null,
    queuedAt: normalizeDate(dto.queuedAt),
    source: dto.source.trim() || 'unknown',
    startedAt: normalizeNullableDate(dto.startedAt),
    status: normalizeStatus(dto.status),
    subjectId: dto.subjectId,
    subjectType: dto.subjectType?.trim() || null,
    updatedAt: normalizeDate(dto.updatedAt),
  };
}

export function normalizeActivityList(items: ActivityDto[], total: number): ActivityList {
  return {
    items: items.map(normalizeActivity),
    total: Number.isFinite(total) ? total : items.length,
  };
}

export function normalizeActivityPreview(items: ActivityDto[], total: number): ActivityPreview {
  return {
    items: items.map(normalizeActivity),
    total: Number.isFinite(total) ? total : items.length,
  };
}

export function normalizeActivityLogs(items: ActivityLogDto[]): ActivityLog[] {
  return items.map((item) => ({
    activityId: item.activityId,
    createdAt: normalizeDate(item.createdAt),
    data: item.data,
    id: item.id,
    level: item.level,
    message: item.message.trim() || '(empty log)',
  }));
}

function normalizeActivityCount(item: { count: number; key: string }): ActivityCount {
  return {
    count: Number.isFinite(item.count) ? item.count : 0,
    key: item.key.trim() || 'unknown',
  };
}

export function normalizeActivityDashboardSummary(
  dto: ActivitySummaryDto,
): ActivityDashboardSummary {
  return {
    active: dto.active.map(normalizeActivity),
    byStatus: dto.byStatus.map(normalizeActivityCount),
    byType: dto.byType.map(normalizeActivityCount),
    total: Number.isFinite(dto.total) ? dto.total : 0,
  };
}

export function normalizeActivityQueueCancellation(
  dto: ActivityQueueCancellationDto,
): ActivityQueueCancellationResult {
  return {
    cancelled: Number.isFinite(dto.cancelled) ? dto.cancelled : 0,
    items: dto.items.map(normalizeActivity),
    requested: Number.isFinite(dto.requested) ? dto.requested : 0,
    total: Number.isFinite(dto.total) ? dto.total : 0,
  };
}

function normalizeLinkedInRawPayloadDebug(
  dto: LinkedInRawPayloadDebugDto,
): LinkedInRawPayloadDebug {
  return {
    contentType: dto.contentType?.trim() || null,
    createdAt: normalizeDate(dto.createdAt),
    elapsedMs: dto.elapsedMs !== null && Number.isFinite(dto.elapsedMs) ? dto.elapsedMs : null,
    error: dto.error?.trim() || null,
    id: dto.id,
    payloadKind: dto.payloadKind,
    requestParams: dto.requestParams,
    requestUrl: dto.requestUrl?.trim() || null,
    responseStatus:
      dto.responseStatus !== null && Number.isFinite(dto.responseStatus)
        ? dto.responseStatus
        : null,
    snippet: dto.snippet?.trim() || null,
  };
}

export function normalizeLinkedInActivityDebug(
  dto: LinkedInActivityDebugDto,
): LinkedInActivityDebug {
  return {
    activityId: dto.activityId,
    activityType: dto.activityType.trim() || 'linkedin_unknown',
    failed: Number.isFinite(dto.failed) ? dto.failed : 0,
    items: dto.items.map(normalizeLinkedInRawPayloadDebug),
    latestStatus:
      dto.latestStatus !== null && Number.isFinite(dto.latestStatus) ? dto.latestStatus : null,
    providerKey: 'linkedin',
    statusCounts: dto.statusCounts.map((item) => ({
      count: Number.isFinite(item.count) ? item.count : 0,
      status: item.status.trim() || 'unknown',
    })),
    total: Number.isFinite(dto.total) ? dto.total : 0,
  };
}
