export type ActivityStatus =
  | 'cancelled'
  | 'failed'
  | 'interrupted'
  | 'queued'
  | 'running'
  | 'success';

export interface ActivitySummary {
  activityType: string;
  createdAt: Date;
  id: string;
  message: string | null;
  phase: string | null;
  progressCurrent: number;
  progressTotal: number | null;
  status: ActivityStatus;
  updatedAt: Date;
}

export interface Activity extends ActivitySummary {
  attempt: number;
  cancelRequestedAt: Date | null;
  error: string | null;
  finishedAt: Date | null;
  heartbeatAt: Date | null;
  leaseExpiresAt: Date | null;
  leaseOwner: string | null;
  maxAttempts: number;
  payload: unknown;
  queuedAt: Date;
  source: string;
  startedAt: Date | null;
  subjectId: string | null;
  subjectType: string | null;
}

export interface ActivityList {
  items: Activity[];
  total: number;
}

export interface ActivityLog {
  activityId: string;
  createdAt: Date;
  data: unknown;
  id: string;
  level: 'debug' | 'error' | 'info' | 'warn';
  message: string;
}

export interface ActivityPreview {
  items: ActivitySummary[];
  total: number;
}

export interface ActivityCount {
  count: number;
  key: string;
}

export interface ActivityDashboardSummary {
  active: Activity[];
  byStatus: ActivityCount[];
  byType: ActivityCount[];
  total: number;
}

export interface ActivityFilters {
  source: string;
  status: ActivityStatus | '';
  type: string;
}

export interface ActivityQueueCancellationResult {
  cancelled: number;
  items: Activity[];
  requested: number;
  total: number;
}

export interface LinkedInRawPayloadDebug {
  contentType: string | null;
  createdAt: Date;
  elapsedMs: number | null;
  error: string | null;
  id: string;
  payloadKind: 'empty' | 'json' | 'text';
  requestParams: unknown;
  requestUrl: string | null;
  responseStatus: number | null;
  snippet: string | null;
}

export interface LinkedInRawPayloadStatusCount {
  count: number;
  status: string;
}

export interface LinkedInActivityDebug {
  activityId: string;
  activityType: string;
  failed: number;
  items: LinkedInRawPayloadDebug[];
  latestStatus: number | null;
  providerKey: 'linkedin';
  statusCounts: LinkedInRawPayloadStatusCount[];
  total: number;
}

export const activityStatusOptions: Array<{ label: string; value: ActivityStatus }> = [
  { label: 'In coda', value: 'queued' },
  { label: 'In corso', value: 'running' },
  { label: 'Completata', value: 'success' },
  { label: 'Errore', value: 'failed' },
  { label: 'Annullata', value: 'cancelled' },
  { label: 'Interrotta', value: 'interrupted' },
];

export const activityTypeOptions = [
  'ai_review',
  'dummy',
  'export',
  'linkedin_availability',
  'linkedin_collect',
  'linkedin_describe',
  'model_install',
];

const retryableActivityTypes = new Set(activityTypeOptions);

export function createDefaultActivityFilters(): ActivityFilters {
  return {
    source: '',
    status: '',
    type: '',
  };
}

export function getActivityStatusLabel(status: ActivityStatus): string {
  switch (status) {
    case 'queued':
      return 'In coda';
    case 'running':
      return 'In corso';
    case 'success':
      return 'Completata';
    case 'failed':
      return 'Errore';
    case 'cancelled':
      return 'Annullata';
    case 'interrupted':
      return 'Interrotta';
  }
}

export function getActivityStatusVariant(
  status: ActivityStatus,
): 'danger' | 'info' | 'secondary' | 'success' | 'warning' {
  switch (status) {
    case 'queued':
      return 'secondary';
    case 'running':
      return 'info';
    case 'success':
      return 'success';
    case 'failed':
      return 'danger';
    case 'cancelled':
      return 'warning';
    case 'interrupted':
      return 'warning';
  }
}

export function isActiveActivity(status: ActivityStatus): boolean {
  return status === 'queued' || status === 'running';
}

export function canCancelActivity(activity: Activity): boolean {
  return activity.status === 'queued' || activity.status === 'running';
}

export function canRetryActivity(activity: Activity): boolean {
  return activity.status === 'failed' && retryableActivityTypes.has(activity.activityType);
}

export function isLinkedInActivity(activity: Activity): boolean {
  return activity.activityType.startsWith('linkedin_');
}

export function getActivityProgressPercent(activity: ActivitySummary): number {
  if (!activity.progressTotal || activity.progressTotal <= 0) {
    return activity.status === 'success' ? 100 : 0;
  }

  const percent = Math.round((activity.progressCurrent / activity.progressTotal) * 100);
  return Math.max(0, Math.min(100, percent));
}

export function getActivityLogVariant(
  level: ActivityLog['level'],
): 'danger' | 'info' | 'secondary' | 'warning' {
  switch (level) {
    case 'debug':
      return 'secondary';
    case 'info':
      return 'info';
    case 'warn':
      return 'warning';
    case 'error':
      return 'danger';
  }
}
