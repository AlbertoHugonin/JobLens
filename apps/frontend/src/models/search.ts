export type LinkedInDistance = '0' | '5' | '10' | '25' | '50';
export type LinkedInExperienceLevel = '1' | '2' | '3' | '4' | '5' | '6';
export type LinkedInWorkplaceType = '1' | '2' | '3';

export const linkedInDistanceOptions: Array<{ label: string; value: LinkedInDistance }> = [
  { label: 'Localita esatta', value: '0' },
  { label: 'circa 8 km', value: '5' },
  { label: 'circa 16 km', value: '10' },
  { label: 'circa 40 km', value: '25' },
  { label: 'circa 80 km', value: '50' },
];

export const linkedInExperienceOptions: Array<{
  label: string;
  value: LinkedInExperienceLevel;
}> = [
  { label: 'Stage / Internship', value: '1' },
  { label: 'Entry level', value: '2' },
  { label: 'Associate', value: '3' },
  { label: 'Mid-Senior', value: '4' },
  { label: 'Director', value: '5' },
  { label: 'Executive', value: '6' },
];

export const linkedInWorkplaceOptions: Array<{
  label: string;
  value: LinkedInWorkplaceType;
}> = [
  { label: 'In sede', value: '1' },
  { label: 'Remoto', value: '2' },
  { label: 'Ibrido', value: '3' },
];

export const searchScheduleDayOptions: Array<{ label: string; value: number }> = [
  { label: 'Lun', value: 1 },
  { label: 'Mar', value: 2 },
  { label: 'Mer', value: 3 },
  { label: 'Gio', value: 4 },
  { label: 'Ven', value: 5 },
  { label: 'Sab', value: 6 },
  { label: 'Dom', value: 0 },
];

export interface LinkedInSearchQuery {
  currentJobId: string | null;
  distance: LinkedInDistance;
  exactMatch: boolean;
  experienceLevels: LinkedInExperienceLevel[];
  geoId: string;
  keywords: string;
  location: string;
  preservedParams: Record<string, string>;
  providerKey: 'linkedin';
  publicUrl: string;
  unsupportedParams: Record<string, string>;
  workplaceTypes: LinkedInWorkplaceType[];
}

export interface SearchInactiveWindow {
  enabled: boolean;
  endTime: string;
  startTime: string;
}

export interface SearchScheduleConfig {
  activeDays: number[];
  enabled: boolean;
  extraDelayMinutes: number;
  inactiveWindow: SearchInactiveWindow;
  intervalMinutes: number;
}

export interface LinkedInSearchDraft {
  distance: LinkedInDistance;
  enabled: boolean;
  exactMatch: boolean;
  experienceLevels: LinkedInExperienceLevel[];
  geoId: string;
  keywords: string;
  location: string;
  name: string;
  scheduleConfig: SearchScheduleConfig;
  workplaceTypes: LinkedInWorkplaceType[];
}

export interface Search {
  createdAt: Date;
  enabled: boolean;
  id: string;
  lastRunAt: Date | null;
  name: string;
  providerKey: 'linkedin';
  providerName: string;
  query: LinkedInSearchQuery;
  scheduleConfig: SearchScheduleConfig;
  updatedAt: Date;
}

export interface SearchList {
  items: Search[];
  total: number;
}

export interface SearchPreview {
  query: LinkedInSearchQuery;
  url: string;
}

export interface LinkedInGeoHit {
  displayName: string;
  geoId: string;
  type: string | null;
}

export interface LinkedInHarRequestDebug {
  count: string | null;
  decorationId: string | null;
  hasCookie: boolean;
  hasCsrfToken: boolean;
  hasQuery: boolean;
  host: string;
  method: string;
  path: string;
  q: string | null;
  queryParamNames: string[];
  recognizedFilters: string[];
  start: string | null;
}

export interface LinkedInHarDebug {
  jobCardRequestCount: number;
  requests: LinkedInHarRequestDebug[];
  selectedRequest: LinkedInHarRequestDebug | null;
}

export interface ProviderSessionSummary {
  acceptLanguage: string | null;
  decorationId: string | null;
  hasJsessionid: boolean;
  hasLiAt: boolean;
  hasXLiTrack: boolean;
  importedAt: Date | null;
  jobCardRequestCount: number;
  source: string | null;
  userAgent: string | null;
  xLiLang: string | null;
}

export interface ProviderSession {
  createdAt: Date;
  id: string;
  label: string;
  lastVerifiedAt: Date | null;
  providerKey: string;
  providerName: string;
  status: 'active' | 'disabled' | 'expired' | 'invalid';
  summary: ProviderSessionSummary;
  updatedAt: Date;
}

export interface CredentialField {
  help: string | null;
  label: string;
  name: string;
  placeholder: string | null;
  required: boolean;
  secret: boolean;
}

export interface ProviderDescriptor {
  credentialFields: CredentialField[];
  key: string;
  name: string;
  supportsHarImport: boolean;
  supportsVerify: boolean;
}

export interface SessionVerification {
  alive: boolean;
  message: string | null;
  session: ProviderSession | null;
  status: number | null;
}

export function createDefaultSearchScheduleConfig(): SearchScheduleConfig {
  return {
    activeDays: [1, 2, 3, 4, 5],
    enabled: false,
    extraDelayMinutes: 0,
    inactiveWindow: {
      enabled: false,
      endTime: '06:00',
      startTime: '22:00',
    },
    intervalMinutes: 1440,
  };
}

function cloneSearchScheduleConfig(scheduleConfig: SearchScheduleConfig): SearchScheduleConfig {
  return {
    activeDays: [...scheduleConfig.activeDays],
    enabled: scheduleConfig.enabled,
    extraDelayMinutes: scheduleConfig.extraDelayMinutes,
    inactiveWindow: { ...scheduleConfig.inactiveWindow },
    intervalMinutes: scheduleConfig.intervalMinutes,
  };
}

export function createEmptyLinkedInSearchDraft(): LinkedInSearchDraft {
  return {
    distance: '25',
    enabled: true,
    exactMatch: false,
    experienceLevels: ['1', '2', '3'],
    geoId: '',
    keywords: '',
    location: '',
    name: '',
    scheduleConfig: createDefaultSearchScheduleConfig(),
    workplaceTypes: [],
  };
}

export function createDraftFromSearch(search: Search): LinkedInSearchDraft {
  return {
    distance: search.query.distance,
    enabled: search.enabled,
    exactMatch: search.query.exactMatch,
    experienceLevels: [...search.query.experienceLevels],
    geoId: search.query.geoId,
    keywords: search.query.keywords,
    location: search.query.location,
    name: search.name,
    scheduleConfig: cloneSearchScheduleConfig(search.scheduleConfig),
    workplaceTypes: [...search.query.workplaceTypes],
  };
}

export function createDuplicateDraftFromSearch(search: Search): LinkedInSearchDraft {
  const draft = createDraftFromSearch(search);
  return {
    ...draft,
    name: `Copia di ${draft.name}`,
  };
}

export function createDraftFromQuery(query: LinkedInSearchQuery): LinkedInSearchDraft {
  return {
    distance: query.distance,
    enabled: true,
    exactMatch: query.exactMatch,
    experienceLevels: [...query.experienceLevels],
    geoId: query.geoId,
    keywords: query.keywords,
    location: query.location,
    name: '',
    scheduleConfig: createDefaultSearchScheduleConfig(),
    workplaceTypes: [...query.workplaceTypes],
  };
}

export function getLinkedInExperienceLabel(value: LinkedInExperienceLevel): string {
  return linkedInExperienceOptions.find((option) => option.value === value)?.label ?? value;
}

export function getLinkedInDistanceLabel(value: LinkedInDistance): string {
  return linkedInDistanceOptions.find((option) => option.value === value)?.label ?? value;
}

export function getLinkedInWorkplaceLabel(value: LinkedInWorkplaceType): string {
  return linkedInWorkplaceOptions.find((option) => option.value === value)?.label ?? value;
}
