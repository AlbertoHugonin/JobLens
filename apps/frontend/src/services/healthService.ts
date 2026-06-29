import type { ApiHealthDto } from '../API/health';
import type { ServiceHealth, ServiceStatus } from '../models/health';

function normalizeStatus(status: string): ServiceStatus {
  if (status === 'ok' || status === 'degraded' || status === 'error') {
    return status;
  }

  return 'error';
}

export function normalizeApiHealth(dto: ApiHealthDto): ServiceHealth {
  return {
    checkedAt: new Date(dto.timestamp),
    name: dto.service.trim() || 'api',
    status: normalizeStatus(dto.status),
    uptimeSeconds: Number.isFinite(dto.uptimeSeconds) ? dto.uptimeSeconds : 0,
    version: dto.version.trim() || '0.0.0',
  };
}
