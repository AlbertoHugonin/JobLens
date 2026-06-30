import type { Activity } from './activity';

export type JobAvailabilityStatus =
  | 'active'
  | 'available_outside_searches'
  | 'missing_from_searches'
  | 'unavailable';

export type JobLocalStatus = 'applied' | 'new' | 'saved' | 'viewed';
export type JobReviewDecision = 'apply' | 'maybe' | 'reject';
export type JobReviewMode = 'automatic' | 'benchmark' | 'manual';
export type JobScope = 'all' | 'standard';
export type JobSortBy = 'aiScore' | 'publishedAt' | 'repostedAt';
export type JobSortDir = 'asc' | 'desc';
export type JobReviewStatus = 'failed' | 'success';
export type JobWorkplaceMode = 'hybrid' | 'onsite' | 'remote';

export interface JobExternal {
  externalId: string;
  externalUrl: string | null;
  firstSeenAt: Date;
  id: string;
  lastSeenAt: Date;
  providerKey: string;
  providerName: string;
}

export interface JobSearchPresence {
  firstSeenAt: Date;
  lastActivityId: string | null;
  lastSeenAt: Date;
  providerKey: string;
  searchId: string;
  searchName: string;
}

export interface JobReviewSummary {
  createdAt: Date;
  decision: JobReviewDecision | null;
  id: string;
  isPriority: boolean;
  modelName: string;
  priorityReason: string;
  reviewMode: string | null;
  score: number | null;
  status: JobReviewStatus;
}

export interface JobReviewDetail extends JobReviewSummary {
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

export interface JobDescription {
  fetchedAt: Date;
  html: string | null;
  htmlAvailable: boolean;
  id: string;
  source: string;
  text: string;
}

export interface JobSummary {
  availabilityStatus: JobAvailabilityStatus;
  companyName: string;
  createdAt: Date;
  employmentType: string | null;
  externalJobs: JobExternal[];
  id: string;
  latestReview: JobReviewSummary | null;
  localStatus: JobLocalStatus;
  locationText: string | null;
  providerUrl: string | null;
  publishedAt: Date | null;
  repostedAt: Date | null;
  searches: JobSearchPresence[];
  seniority: string | null;
  sourceUrl: string | null;
  title: string;
  updatedAt: Date;
  workplaceType: string | null;
}

export interface JobDetail extends JobSummary {
  description: JobDescription | null;
}

export interface JobList {
  items: JobSummary[];
  total: number;
}

export interface JobFilters {
  availabilityStatus: JobAvailabilityStatus | '';
  decision: JobReviewDecision[];
  localStatus: JobLocalStatus | '';
  location: string;
  modelName: string;
  providerKey: 'linkedin' | '';
  scope: JobScope;
  searchId: string;
  sortBy: JobSortBy;
  sortDir: JobSortDir;
  text: string;
  workplace: JobWorkplaceMode | '';
}

export interface JobExport {
  exportedAt: Date;
  externalJobs: JobExternal[];
  job: Record<string, unknown>;
  latestDescription: JobDescription | null;
  latestReview: JobReviewSummary | null;
  reviews: JobReviewDetail[];
  searches: JobSearchPresence[];
}

export interface SkippedJobReview {
  jobId: string;
  reason: string;
}

export interface BatchJobReviewResult {
  queued: Activity[];
  skipped: SkippedJobReview[];
}

export interface JobDecisionCount {
  count: number;
  key: JobReviewDecision | 'none';
}

export interface JobInsights {
  averageScore: number | null;
  byDecision: JobDecisionCount[];
  reviewed: number;
  topMatches: JobSummary[];
  totalActive: number;
  unreviewed: number;
}

export const jobLocalStatusOptions: Array<{ label: string; value: JobLocalStatus }> = [
  { label: 'Non vista', value: 'new' },
  { label: 'Vista', value: 'viewed' },
  { label: 'Salvata', value: 'saved' },
  { label: 'Candidata', value: 'applied' },
];

export const jobAvailabilityStatusOptions: Array<{
  label: string;
  value: JobAvailabilityStatus;
}> = [
  { label: 'Attiva', value: 'active' },
  { label: 'Fuori dalle ricerche', value: 'missing_from_searches' },
  { label: 'Disponibile fuori ricerca', value: 'available_outside_searches' },
  { label: 'Non disponibile', value: 'unavailable' },
];

export const jobReviewDecisionOptions: Array<{ label: string; value: JobReviewDecision }> = [
  { label: 'Apply', value: 'apply' },
  { label: 'Maybe', value: 'maybe' },
  { label: 'Reject', value: 'reject' },
];

export const jobWorkplaceModeOptions: Array<{ label: string; value: JobWorkplaceMode }> = [
  { label: 'In sede', value: 'onsite' },
  { label: 'Remoto', value: 'remote' },
  { label: 'Ibrido', value: 'hybrid' },
];

export function createDefaultJobFilters(): JobFilters {
  return {
    availabilityStatus: 'active',
    // Default to no AI-decision filter so every offer is visible from the start,
    // including those not yet reviewed by the AI. Users can narrow down after.
    decision: [],
    localStatus: 'new',
    location: '',
    modelName: '',
    providerKey: '',
    scope: 'standard',
    searchId: '',
    sortBy: 'publishedAt',
    sortDir: 'desc',
    text: '',
    workplace: '',
  };
}

export function getJobLocalStatusLabel(status: JobLocalStatus): string {
  return jobLocalStatusOptions.find((option) => option.value === status)?.label ?? status;
}

export function getJobAvailabilityStatusLabel(status: JobAvailabilityStatus): string {
  return jobAvailabilityStatusOptions.find((option) => option.value === status)?.label ?? status;
}

export function getJobDecisionLabel(decision: JobReviewDecision): string {
  return jobReviewDecisionOptions.find((option) => option.value === decision)?.label ?? decision;
}

export function getJobReviewPriorityLabel(reason: string): string {
  switch (reason) {
    case 'priority_model':
      return 'Modello prioritario';
    case 'latest_success':
      return 'Ultima review riuscita';
    default:
      return 'Review piu recente';
  }
}

export function getJobLocalStatusVariant(
  status: JobLocalStatus,
): 'info' | 'primary' | 'secondary' | 'success' {
  switch (status) {
    case 'new':
      return 'secondary';
    case 'viewed':
      return 'info';
    case 'saved':
      return 'primary';
    case 'applied':
      return 'success';
  }
}

export function getJobAvailabilityStatusVariant(
  status: JobAvailabilityStatus,
): 'danger' | 'secondary' | 'success' | 'warning' {
  switch (status) {
    case 'active':
      return 'success';
    case 'missing_from_searches':
      return 'warning';
    case 'available_outside_searches':
      return 'secondary';
    case 'unavailable':
      return 'danger';
  }
}

export function getJobDecisionVariant(
  decision: JobReviewDecision,
): 'danger' | 'secondary' | 'success' | 'warning' {
  switch (decision) {
    case 'apply':
      return 'success';
    case 'maybe':
      return 'warning';
    case 'reject':
      return 'danger';
  }
}
