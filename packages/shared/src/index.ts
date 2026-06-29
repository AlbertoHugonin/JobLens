export const API_VERSION = 'v1';

export type ServiceStatus = 'ok' | 'degraded' | 'error';

export interface HealthResponseDto {
  service: string;
  status: ServiceStatus;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}
