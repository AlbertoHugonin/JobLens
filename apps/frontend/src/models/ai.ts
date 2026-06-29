import type { Activity } from './activity';

export interface AiRuntimeSettings {
  keepAlive: string;
  modelName: string;
  numCtx: number;
  numPredict: number;
  priorityModelName: string;
  retryAttempts: number;
  retryDelaySeconds: number;
  temperature: number;
  think: boolean;
  timeoutSeconds: number;
}

export interface AiPauseWindow {
  dayOfWeek: number;
  enabled: boolean;
  endTime: string;
  startTime: string;
}

export interface AiSettings {
  activeEndpointId: string | null;
  candidateProfile: string;
  enabled: boolean;
  evaluationRules: string;
  pauses: AiPauseWindow[];
  rulesTemplate: string;
  rulesTemplateVersion: number;
  runtime: AiRuntimeSettings;
  updatedAt: Date;
}

export interface AiEndpoint {
  baseUrl: string;
  createdAt: Date;
  enabled: boolean;
  id: string;
  isActive: boolean;
  name: string;
  updatedAt: Date;
}

export interface AiModel {
  createdAt: Date;
  discoveredAt: Date;
  endpointId: string;
  endpointName: string;
  id: string;
  installed: boolean;
  name: string;
  updatedAt: Date;
}

export interface AiModelInstallResult {
  activity: Activity;
  model: AiModel;
}

export interface AiEndpointHealth {
  checkedAt: Date;
  endpointId: string;
  latencyMs: number | null;
  message: string | null;
  reachable: boolean;
  status: number | null;
  version: string | null;
}

export const aiPauseDayOptions: Array<{ label: string; value: number }> = [
  { label: 'Domenica', value: 0 },
  { label: 'Lunedi', value: 1 },
  { label: 'Martedi', value: 2 },
  { label: 'Mercoledi', value: 3 },
  { label: 'Giovedi', value: 4 },
  { label: 'Venerdi', value: 5 },
  { label: 'Sabato', value: 6 },
];

export function getAiPauseDayLabel(dayOfWeek: number): string {
  return aiPauseDayOptions.find((option) => option.value === dayOfWeek)?.label ?? String(dayOfWeek);
}

export function getAiEndpointStateLabel(endpoint: AiEndpoint): string {
  if (endpoint.isActive) {
    return 'Attivo';
  }

  if (!endpoint.enabled) {
    return 'Disabilitato';
  }

  // Enabled but not the active endpoint. This reflects configuration state only,
  // not whether the server is reachable — so avoid words like "Disponibile".
  return 'In standby';
}

export function getAiEndpointStateVariant(
  endpoint: AiEndpoint,
): 'secondary' | 'success' | 'warning' {
  if (endpoint.isActive) {
    return 'success';
  }

  if (!endpoint.enabled) {
    return 'secondary';
  }

  return 'warning';
}
