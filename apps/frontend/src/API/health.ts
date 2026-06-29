import { apiRequest, type ApiSuccessDto } from './client';

export interface ApiHealthDto {
  service: string;
  status: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

export async function fetchApiHealth(): Promise<ApiHealthDto> {
  const response = await apiRequest<ApiSuccessDto<ApiHealthDto>>('/api/v1/health');
  return response.data;
}
