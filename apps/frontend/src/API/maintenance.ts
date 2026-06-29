import { apiRequest, type ApiSuccessDto } from './client';
import type { ActivityDto } from './activities';

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
