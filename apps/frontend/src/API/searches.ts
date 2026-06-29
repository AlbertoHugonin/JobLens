import { apiRequest, type ApiSuccessDto, type PaginationMetaDto } from './client';
import type { ActivityDto } from './activities';

export type LinkedInDistanceDto = '0' | '5' | '10' | '25' | '50';
export type LinkedInExperienceLevelDto = '1' | '2' | '3' | '4' | '5' | '6';
export type LinkedInWorkplaceTypeDto = '1' | '2' | '3';

export interface LinkedInSearchQueryDto {
  currentJobId: string | null;
  distance: LinkedInDistanceDto;
  exactMatch: boolean;
  experienceLevels: LinkedInExperienceLevelDto[];
  geoId: string;
  keywords: string;
  location: string;
  preservedParams: Record<string, string>;
  providerKey: 'linkedin';
  publicUrl: string;
  unsupportedParams: Record<string, string>;
  workplaceTypes: LinkedInWorkplaceTypeDto[];
}

export interface SearchInactiveWindowDto {
  enabled: boolean;
  endTime: string;
  startTime: string;
}

export interface SearchScheduleConfigDto {
  activeDays: number[];
  enabled: boolean;
  extraDelayMinutes: number;
  inactiveWindow: SearchInactiveWindowDto;
  intervalMinutes: number;
}

export interface SearchDto {
  createdAt: string;
  enabled: boolean;
  id: string;
  lastRunAt: string | null;
  name: string;
  providerKey: 'linkedin';
  providerName: string;
  query: LinkedInSearchQueryDto;
  scheduleConfig: SearchScheduleConfigDto | unknown;
  updatedAt: string;
}

export interface SearchListParams {
  limit?: number | undefined;
  offset?: number | undefined;
  providerKey?: 'linkedin' | undefined;
}

export interface SearchSaveInput {
  enabled?: boolean | undefined;
  name: string;
  providerKey: 'linkedin';
  query: unknown;
  scheduleConfig?: SearchScheduleConfigDto | undefined;
}

export interface SearchUpdateInput {
  enabled?: boolean | undefined;
  name?: string | undefined;
  query?: unknown | undefined;
  scheduleConfig?: SearchScheduleConfigDto | undefined;
}

export interface SearchPreviewDto {
  providerKey: 'linkedin';
  query: LinkedInSearchQueryDto;
  url: string;
}

export interface SearchRunSkipDto {
  reason: 'not_found_or_disabled';
  searchId: string;
}

export interface SearchRunManyDto {
  queued: ActivityDto[];
  skipped: SearchRunSkipDto[];
  total: number;
}

export function fetchSearches(
  params: SearchListParams = {},
): Promise<ApiSuccessDto<SearchDto[], PaginationMetaDto>> {
  const query: Record<string, number | string> = {};

  if (params.limit !== undefined) {
    query.limit = params.limit;
  }

  if (params.offset !== undefined) {
    query.offset = params.offset;
  }

  if (params.providerKey !== undefined) {
    query.providerKey = params.providerKey;
  }

  return apiRequest<ApiSuccessDto<SearchDto[], PaginationMetaDto>>('/api/v1/searches', {}, query);
}

export function fetchSearch(id: string): Promise<ApiSuccessDto<SearchDto>> {
  return apiRequest<ApiSuccessDto<SearchDto>>(`/api/v1/searches/${id}`);
}

export function createSearch(input: SearchSaveInput): Promise<ApiSuccessDto<SearchDto>> {
  return apiRequest<ApiSuccessDto<SearchDto>>('/api/v1/searches', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function updateSearch(
  id: string,
  input: SearchUpdateInput,
): Promise<ApiSuccessDto<SearchDto>> {
  return apiRequest<ApiSuccessDto<SearchDto>>(`/api/v1/searches/${id}`, {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  });
}

export function deleteSearch(id: string): Promise<ApiSuccessDto<{ deleted: boolean; id: string }>> {
  return apiRequest<ApiSuccessDto<{ deleted: boolean; id: string }>>(`/api/v1/searches/${id}`, {
    method: 'DELETE',
  });
}

export function previewSearchUrl(input: {
  providerKey: 'linkedin';
  query: unknown;
}): Promise<ApiSuccessDto<SearchPreviewDto>> {
  return apiRequest<ApiSuccessDto<SearchPreviewDto>>('/api/v1/searches/preview-url', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function importSearchUrl(input: {
  providerKey: 'linkedin';
  url: string;
}): Promise<ApiSuccessDto<SearchPreviewDto>> {
  return apiRequest<ApiSuccessDto<SearchPreviewDto>>('/api/v1/searches/import-url', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function runSearch(id: string): Promise<ApiSuccessDto<ActivityDto>> {
  return apiRequest<ApiSuccessDto<ActivityDto>>(`/api/v1/searches/${id}/run`, {
    method: 'POST',
  });
}

export function runSearches(input: {
  all?: boolean | undefined;
  providerKey?: 'linkedin' | undefined;
  searchIds?: string[] | undefined;
}): Promise<ApiSuccessDto<SearchRunManyDto>> {
  return apiRequest<ApiSuccessDto<SearchRunManyDto>>('/api/v1/searches/run', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}
