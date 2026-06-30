import { apiRequest, type ApiSuccessDto } from './client';
import type { ActivityDto } from './activities';

export interface ApplicationResetDto {
  deleted: Record<string, number>;
  resetAt: string;
  seeded: {
    providers: number;
    settings: number;
  };
}

export interface OperationalClearDto {
  clearedAt: string;
  deleted: Record<string, number>;
}

export function createJobsReviewsExport(): Promise<ApiSuccessDto<ActivityDto>> {
  return apiRequest<ApiSuccessDto<ActivityDto>>('/api/v1/exports/jobs-reviews', {
    method: 'POST',
  });
}

export function createDebugBundle(): Promise<ApiSuccessDto<ActivityDto>> {
  return apiRequest<ApiSuccessDto<ActivityDto>>('/api/v1/debug/bundle', {
    method: 'POST',
  });
}

export function resetApplicationData(input: {
  confirmation: string;
}): Promise<ApiSuccessDto<ApplicationResetDto>> {
  return apiRequest<ApiSuccessDto<ApplicationResetDto>>('/api/v1/debug/reset-app', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function clearOperationalData(input: {
  confirmation: string;
}): Promise<ApiSuccessDto<OperationalClearDto>> {
  return apiRequest<ApiSuccessDto<OperationalClearDto>>('/api/v1/debug/clear-operational-data', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}
