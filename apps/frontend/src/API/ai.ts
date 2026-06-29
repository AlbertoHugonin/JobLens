import { apiRequest, type ApiSuccessDto } from './client';
import type { ActivityDto } from './activities';

export interface AiRuntimeSettingsDto {
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

export interface AiPauseWindowDto {
  dayOfWeek: number;
  enabled: boolean;
  endTime: string;
  startTime: string;
}

export interface AiSettingsDto {
  activeEndpointId: string | null;
  candidateProfile: string;
  enabled: boolean;
  evaluationRules: string;
  pauses: AiPauseWindowDto[];
  rulesTemplate: string;
  rulesTemplateVersion: number;
  runtime: AiRuntimeSettingsDto;
  updatedAt: string;
}

export interface AiEndpointDto {
  baseUrl: string;
  config: unknown;
  createdAt: string;
  enabled: boolean;
  id: string;
  isActive: boolean;
  name: string;
  updatedAt: string;
}

export interface AiModelDto {
  createdAt: string;
  discoveredAt: string;
  endpointId: string;
  endpointName: string;
  id: string;
  installed: boolean;
  metadata: unknown;
  name: string;
  updatedAt: string;
}

export interface AiSettingsUpdateInput {
  candidateProfile?: string | undefined;
  enabled?: boolean | undefined;
  evaluationRules?: string | undefined;
  pauses?: AiPauseWindowDto[] | undefined;
  runtime?: Partial<AiRuntimeSettingsDto> | undefined;
}

export interface AiEndpointInput {
  baseUrl: string;
  enabled?: boolean | undefined;
  name: string;
}

export interface AiEndpointUpdateInput {
  baseUrl?: string | undefined;
  enabled?: boolean | undefined;
  name?: string | undefined;
}

export interface AiModelInstallInput {
  endpointId?: string | undefined;
  modelName: string;
}

export interface AiModelSyncInput {
  endpointId?: string | undefined;
}

export interface AiModelInstallDto {
  activity: ActivityDto;
  model: AiModelDto;
}

export interface AiEndpointHealthDto {
  checkedAt: string;
  endpointId: string;
  latencyMs: number | null;
  message: string | null;
  reachable: boolean;
  status: number | null;
  version: string | null;
}

export interface AiEndpointProbeDto {
  checkedAt: string;
  latencyMs: number | null;
  message: string | null;
  reachable: boolean;
  status: number | null;
  version: string | null;
}

export interface AiModelMetricsDto {
  avgDurationMs: number | null;
  avgOutputTokens: number | null;
  avgPromptTokens: number | null;
  avgScore: number | null;
  avgTokensPerSecond: number | null;
  endpointId: string | null;
  endpointName: string | null;
  failedCount: number;
  lastReviewedAt: string;
  modelName: string;
  reviewCount: number;
  successCount: number;
}

export interface AiBenchmarkInput {
  endpointId?: string | undefined;
  modelName: string;
}

export interface AiBenchmarkDto {
  model: AiModelDto;
  queued: ActivityDto[];
  totalJobs: number;
}

export interface DeleteAiReviewsInput {
  all?: boolean | undefined;
  modelName?: string | undefined;
}

export interface DeleteAiReviewsDto {
  deleted: number;
}

export function fetchAiSettings(): Promise<ApiSuccessDto<AiSettingsDto>> {
  return apiRequest<ApiSuccessDto<AiSettingsDto>>('/api/v1/ai/settings');
}

export function updateAiSettings(
  input: AiSettingsUpdateInput,
): Promise<ApiSuccessDto<AiSettingsDto>> {
  return apiRequest<ApiSuccessDto<AiSettingsDto>>('/api/v1/ai/settings', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  });
}

export function resetAiEvaluationRules(): Promise<ApiSuccessDto<AiSettingsDto>> {
  return apiRequest<ApiSuccessDto<AiSettingsDto>>('/api/v1/ai/settings/rules/reset', {
    method: 'POST',
  });
}

export function fetchAiEndpoints(): Promise<ApiSuccessDto<AiEndpointDto[]>> {
  return apiRequest<ApiSuccessDto<AiEndpointDto[]>>('/api/v1/ai/endpoints');
}

export function createAiEndpoint(input: AiEndpointInput): Promise<ApiSuccessDto<AiEndpointDto>> {
  return apiRequest<ApiSuccessDto<AiEndpointDto>>('/api/v1/ai/endpoints', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function updateAiEndpoint(
  id: string,
  input: AiEndpointUpdateInput,
): Promise<ApiSuccessDto<AiEndpointDto>> {
  return apiRequest<ApiSuccessDto<AiEndpointDto>>(`/api/v1/ai/endpoints/${id}`, {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'PATCH',
  });
}

export function activateAiEndpoint(id: string): Promise<ApiSuccessDto<AiEndpointDto>> {
  return apiRequest<ApiSuccessDto<AiEndpointDto>>(`/api/v1/ai/endpoints/${id}/activate`, {
    method: 'POST',
  });
}

export function deleteAiEndpoint(id: string): Promise<ApiSuccessDto<{ id: string }>> {
  return apiRequest<ApiSuccessDto<{ id: string }>>(`/api/v1/ai/endpoints/${id}`, {
    method: 'DELETE',
  });
}

export function deleteAiModel(id: string): Promise<ApiSuccessDto<{ id: string }>> {
  return apiRequest<ApiSuccessDto<{ id: string }>>(`/api/v1/ai/models/${id}`, {
    method: 'DELETE',
  });
}

export function fetchAiEndpointHealth(id: string): Promise<ApiSuccessDto<AiEndpointHealthDto>> {
  return apiRequest<ApiSuccessDto<AiEndpointHealthDto>>(`/api/v1/ai/endpoints/${id}/health`);
}

export function probeAiEndpointUrl(
  baseUrl: string,
): Promise<ApiSuccessDto<AiEndpointProbeDto>> {
  return apiRequest<ApiSuccessDto<AiEndpointProbeDto>>('/api/v1/ai/endpoints/probe', {
    body: JSON.stringify({ baseUrl }),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function fetchAiModels(endpointId?: string): Promise<ApiSuccessDto<AiModelDto[]>> {
  return apiRequest<ApiSuccessDto<AiModelDto[]>>(
    '/api/v1/ai/models',
    {},
    endpointId ? { endpointId } : undefined,
  );
}

export function syncAiModels(
  input: AiModelSyncInput = {},
): Promise<ApiSuccessDto<AiModelDto[]>> {
  return apiRequest<ApiSuccessDto<AiModelDto[]>>('/api/v1/ai/models/sync', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function fetchAiModelMetrics(): Promise<ApiSuccessDto<AiModelMetricsDto[]>> {
  return apiRequest<ApiSuccessDto<AiModelMetricsDto[]>>('/api/v1/ai/models/metrics');
}

export function installAiModel(
  input: AiModelInstallInput,
): Promise<ApiSuccessDto<AiModelInstallDto>> {
  return apiRequest<ApiSuccessDto<AiModelInstallDto>>('/api/v1/ai/models/install', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function runAiBenchmark(input: AiBenchmarkInput): Promise<ApiSuccessDto<AiBenchmarkDto>> {
  return apiRequest<ApiSuccessDto<AiBenchmarkDto>>('/api/v1/ai/benchmark', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
}

export function deleteAiReviews(
  input: DeleteAiReviewsInput,
): Promise<ApiSuccessDto<DeleteAiReviewsDto>> {
  return apiRequest<ApiSuccessDto<DeleteAiReviewsDto>>('/api/v1/ai/reviews', {
    body: JSON.stringify(input),
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'DELETE',
  });
}
