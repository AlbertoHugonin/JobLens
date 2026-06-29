export type ServiceStatus = 'ok' | 'degraded' | 'error';

export interface ServiceHealth {
  checkedAt: Date;
  name: string;
  status: ServiceStatus;
  uptimeSeconds: number;
  version: string;
}

export function getServiceStatusLabel(status: ServiceStatus): string {
  switch (status) {
    case 'ok':
      return 'Online';
    case 'degraded':
      return 'Degraded';
    case 'error':
      return 'Error';
  }
}

export function getServiceStatusVariant(status: ServiceStatus): 'danger' | 'success' | 'warning' {
  switch (status) {
    case 'ok':
      return 'success';
    case 'degraded':
      return 'warning';
    case 'error':
      return 'danger';
  }
}
