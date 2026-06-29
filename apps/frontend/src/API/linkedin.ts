import { apiRequest, type ApiSuccessDto } from './client';

export interface LinkedInHarRequestDebugDto {
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

export interface LinkedInHarDebugDto {
  jobCardRequestCount: number;
  requests: LinkedInHarRequestDebugDto[];
  selectedRequest: LinkedInHarRequestDebugDto | null;
}

export interface ProviderSessionSummaryDto {
  acceptLanguage: string | null;
  decorationId: string | null;
  hasJsessionid: boolean;
  hasLiAt: boolean;
  hasXLiTrack: boolean;
  importedAt: string | null;
  jobCardRequestCount: number;
  source: string | null;
  userAgent: string | null;
  xLiLang: string | null;
}

export interface ProviderSessionDto {
  createdAt: string;
  id: string;
  label: string;
  lastVerifiedAt: string | null;
  providerKey: string;
  providerName: string;
  status: 'active' | 'disabled' | 'expired' | 'invalid';
  summary: ProviderSessionSummaryDto;
  updatedAt: string;
}

export interface LinkedInGeoHitDto {
  displayName: string;
  geoId: string;
  type: string | null;
}

export interface HarPayload {
  harText: string;
  label?: string | undefined;
}

export function fetchLinkedInSessions(): Promise<ApiSuccessDto<ProviderSessionDto[]>> {
  return apiRequest<ApiSuccessDto<ProviderSessionDto[]>>('/api/v1/providers/linkedin/sessions');
}

export function debugLinkedInHar(input: HarPayload): Promise<ApiSuccessDto<LinkedInHarDebugDto>> {
  return apiRequest<ApiSuccessDto<LinkedInHarDebugDto>>('/api/v1/providers/linkedin/har-debug', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function uploadLinkedInHar(input: HarPayload): Promise<ApiSuccessDto<ProviderSessionDto>> {
  return apiRequest<ApiSuccessDto<ProviderSessionDto>>('/api/v1/providers/linkedin/sessions/har', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function fetchLinkedInGeoTypeahead(
  query: string,
): Promise<ApiSuccessDto<LinkedInGeoHitDto[]>> {
  return apiRequest<ApiSuccessDto<LinkedInGeoHitDto[]>>(
    '/api/v1/providers/linkedin/geo-typeahead',
    {},
    { query },
  );
}
