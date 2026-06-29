import type { LinkedInGeoHitDto, LinkedInHarDebugDto, ProviderSessionDto } from '../API/linkedin';
import type { ProviderDescriptorDto, SessionVerificationDto } from '../API/providers';
import type {
  LinkedInSearchQueryDto,
  SearchDto,
  SearchPreviewDto,
  SearchScheduleConfigDto,
} from '../API/searches';
import type {
  CredentialField,
  LinkedInGeoHit,
  LinkedInHarDebug,
  LinkedInSearchDraft,
  LinkedInSearchQuery,
  ProviderDescriptor,
  ProviderSession,
  Search,
  SearchList,
  SearchPreview,
  SearchScheduleConfig,
  SessionVerification,
} from '../models/search';
import { createDefaultSearchScheduleConfig, searchScheduleDayOptions } from '../models/search';

function normalizeDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function normalizeNullableDate(value: string | null): Date | null {
  return value ? normalizeDate(value) : null;
}

function normalizeStringRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter(([key, item]) => key.trim() && item.trim()),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function normalizeTime(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : fallback;
}

function normalizeActiveDays(value: unknown): number[] {
  const allowed = new Set(searchScheduleDayOptions.map((option) => option.value));
  if (!Array.isArray(value)) {
    return [...createDefaultSearchScheduleConfig().activeDays];
  }

  const days = value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && allowed.has(item));

  return days.length > 0
    ? Array.from(new Set(days))
    : [...createDefaultSearchScheduleConfig().activeDays];
}

export function normalizeSearchScheduleConfig(
  dto: SearchScheduleConfigDto | unknown,
): SearchScheduleConfig {
  const defaults = createDefaultSearchScheduleConfig();
  if (!isRecord(dto)) {
    return defaults;
  }

  const inactiveWindow = isRecord(dto.inactiveWindow) ? dto.inactiveWindow : {};

  return {
    activeDays: normalizeActiveDays(dto.activeDays),
    enabled: normalizeBoolean(dto.enabled, defaults.enabled),
    extraDelayMinutes: normalizeNumber(dto.extraDelayMinutes, defaults.extraDelayMinutes, 0, 43200),
    inactiveWindow: {
      enabled: normalizeBoolean(inactiveWindow.enabled, defaults.inactiveWindow.enabled),
      endTime: normalizeTime(inactiveWindow.endTime, defaults.inactiveWindow.endTime),
      startTime: normalizeTime(inactiveWindow.startTime, defaults.inactiveWindow.startTime),
    },
    intervalMinutes: normalizeNumber(dto.intervalMinutes, defaults.intervalMinutes, 1, 43200),
  };
}

export function normalizeLinkedInQuery(dto: LinkedInSearchQueryDto): LinkedInSearchQuery {
  return {
    currentJobId: dto.currentJobId?.trim() || null,
    distance: dto.distance,
    exactMatch: dto.exactMatch,
    experienceLevels: [...dto.experienceLevels],
    geoId: dto.geoId.trim(),
    keywords: dto.keywords.trim(),
    location: dto.location.trim(),
    preservedParams: normalizeStringRecord(dto.preservedParams),
    providerKey: 'linkedin',
    publicUrl: dto.publicUrl,
    unsupportedParams: normalizeStringRecord(dto.unsupportedParams),
    workplaceTypes: [...(dto.workplaceTypes ?? [])],
  };
}

export function normalizeSearch(dto: SearchDto): Search {
  return {
    createdAt: normalizeDate(dto.createdAt),
    enabled: dto.enabled,
    id: dto.id,
    lastRunAt: normalizeNullableDate(dto.lastRunAt),
    name: dto.name.trim() || 'Ricerca LinkedIn',
    providerKey: dto.providerKey,
    providerName: dto.providerName.trim() || 'LinkedIn',
    query: normalizeLinkedInQuery(dto.query),
    scheduleConfig: normalizeSearchScheduleConfig(dto.scheduleConfig),
    updatedAt: normalizeDate(dto.updatedAt),
  };
}

export function normalizeSearchList(items: SearchDto[], total: number): SearchList {
  return {
    items: items.map(normalizeSearch),
    total: Number.isFinite(total) ? total : items.length,
  };
}

export function normalizeSearchPreview(dto: SearchPreviewDto): SearchPreview {
  return {
    query: normalizeLinkedInQuery(dto.query),
    url: dto.url,
  };
}

export function normalizeProviderSession(dto: ProviderSessionDto): ProviderSession {
  return {
    createdAt: normalizeDate(dto.createdAt),
    id: dto.id,
    label: dto.label.trim() || 'LinkedIn HAR',
    lastVerifiedAt: normalizeNullableDate(dto.lastVerifiedAt),
    providerKey: dto.providerKey,
    providerName: dto.providerName.trim() || 'LinkedIn',
    status: dto.status,
    summary: {
      acceptLanguage: dto.summary.acceptLanguage?.trim() || null,
      decorationId: dto.summary.decorationId?.trim() || null,
      hasJsessionid: Boolean(dto.summary.hasJsessionid),
      hasLiAt: Boolean(dto.summary.hasLiAt),
      hasXLiTrack: Boolean(dto.summary.hasXLiTrack),
      importedAt: normalizeNullableDate(dto.summary.importedAt),
      jobCardRequestCount: Number.isFinite(dto.summary.jobCardRequestCount)
        ? dto.summary.jobCardRequestCount
        : 0,
      source: dto.summary.source?.trim() || null,
      userAgent: dto.summary.userAgent?.trim() || null,
      xLiLang: dto.summary.xLiLang?.trim() || null,
    },
    updatedAt: normalizeDate(dto.updatedAt),
  };
}

export function normalizeProviderSessions(items: ProviderSessionDto[]): ProviderSession[] {
  return items.map(normalizeProviderSession);
}

export function normalizeProviderDescriptor(dto: ProviderDescriptorDto): ProviderDescriptor {
  const credentialFields: CredentialField[] = dto.credentialFields.map((field) => ({
    help: field.help?.trim() || null,
    label: field.label.trim() || field.name,
    name: field.name,
    placeholder: field.placeholder?.trim() || null,
    required: field.required,
    secret: field.secret,
  }));

  return {
    credentialFields,
    key: dto.key,
    name: dto.name.trim() || dto.key,
    supportsHarImport: dto.supportsHarImport,
    supportsVerify: dto.supportsVerify,
  };
}

export function normalizeSessionVerification(dto: SessionVerificationDto): SessionVerification {
  return {
    alive: dto.alive,
    message: dto.message?.trim() || null,
    session: dto.session ? normalizeProviderSession(dto.session) : null,
    status: typeof dto.status === 'number' ? dto.status : null,
  };
}

export function normalizeHarDebug(dto: LinkedInHarDebugDto): LinkedInHarDebug {
  const requests = dto.requests.map((request) => ({
    count: request.count,
    decorationId: request.decorationId,
    hasCookie: request.hasCookie,
    hasCsrfToken: request.hasCsrfToken,
    hasQuery: request.hasQuery,
    host: request.host,
    method: request.method,
    path: request.path,
    q: request.q,
    queryParamNames: [...request.queryParamNames],
    recognizedFilters: [...request.recognizedFilters],
    start: request.start,
  }));

  return {
    jobCardRequestCount: dto.jobCardRequestCount,
    requests,
    selectedRequest: requests[0] ?? null,
  };
}

export function normalizeGeoHits(items: LinkedInGeoHitDto[]): LinkedInGeoHit[] {
  return items
    .map((item) => ({
      displayName: item.displayName.trim(),
      geoId: item.geoId.trim(),
      type: item.type?.trim() || null,
    }))
    .filter((item) => item.displayName && item.geoId);
}

export function draftToLinkedInQueryInput(draft: LinkedInSearchDraft): Record<string, unknown> {
  return {
    distance: draft.distance,
    exactMatch: draft.exactMatch,
    experienceLevels: draft.experienceLevels,
    geoId: draft.geoId.trim(),
    keywords: draft.keywords.trim(),
    location: draft.location.trim(),
    workplaceTypes: draft.workplaceTypes,
  };
}

export function validateLinkedInSearchDraft(draft: LinkedInSearchDraft): string | null {
  if (!draft.name.trim()) {
    return 'Il nome ricerca e obbligatorio';
  }

  if (!draft.keywords.trim()) {
    return 'Le keyword sono obbligatorie';
  }

  if (!draft.location.trim()) {
    return 'La localita e obbligatoria';
  }

  if (!draft.geoId.trim()) {
    return 'Seleziona o inserisci un geoId LinkedIn';
  }

  return null;
}
