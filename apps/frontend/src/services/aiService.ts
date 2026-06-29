import type {
  AiEndpointDto,
  AiEndpointHealthDto,
  AiModelDto,
  AiModelInstallDto,
  AiPauseWindowDto,
  AiRuntimeSettingsDto,
  AiSettingsDto,
} from '../API/ai';
import type {
  AiEndpoint,
  AiEndpointHealth,
  AiModel,
  AiModelInstallResult,
  AiPauseWindow,
  AiRuntimeSettings,
  AiSettings,
} from '../models/ai';
import { normalizeActivity } from './activityService';

const DEFAULT_RUNTIME: AiRuntimeSettings = {
  keepAlive: '10m',
  modelName: '',
  numCtx: 8192,
  numPredict: 1024,
  priorityModelName: '',
  retryAttempts: 1,
  retryDelaySeconds: 30,
  temperature: 0.2,
  think: false,
  timeoutSeconds: 120,
};

function normalizeDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function normalizeString(value: string, fallback = ''): string {
  return value.trim() || fallback;
}

function normalizeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeAiRuntime(dto: AiRuntimeSettingsDto): AiRuntimeSettings {
  return {
    keepAlive: normalizeString(dto.keepAlive, DEFAULT_RUNTIME.keepAlive),
    modelName: normalizeString(dto.modelName),
    numCtx: Math.max(512, Math.round(normalizeNumber(dto.numCtx, DEFAULT_RUNTIME.numCtx))),
    numPredict: Math.max(
      128,
      Math.round(normalizeNumber(dto.numPredict, DEFAULT_RUNTIME.numPredict)),
    ),
    priorityModelName: normalizeString(dto.priorityModelName),
    retryAttempts: Math.max(
      0,
      Math.round(normalizeNumber(dto.retryAttempts, DEFAULT_RUNTIME.retryAttempts)),
    ),
    retryDelaySeconds: Math.max(
      0,
      Math.round(normalizeNumber(dto.retryDelaySeconds, DEFAULT_RUNTIME.retryDelaySeconds)),
    ),
    temperature: Math.max(
      0,
      Math.min(2, normalizeNumber(dto.temperature, DEFAULT_RUNTIME.temperature)),
    ),
    think: dto.think,
    timeoutSeconds: Math.max(
      5,
      Math.round(normalizeNumber(dto.timeoutSeconds, DEFAULT_RUNTIME.timeoutSeconds)),
    ),
  };
}

export function normalizeAiPause(dto: AiPauseWindowDto): AiPauseWindow {
  return {
    dayOfWeek: Math.max(0, Math.min(6, Math.round(normalizeNumber(dto.dayOfWeek, 0)))),
    enabled: dto.enabled,
    endTime: normalizeString(dto.endTime, '18:00'),
    startTime: normalizeString(dto.startTime, '09:00'),
  };
}

export function normalizeAiSettings(dto: AiSettingsDto): AiSettings {
  return {
    activeEndpointId: dto.activeEndpointId?.trim() || null,
    candidateProfile: normalizeString(dto.candidateProfile),
    enabled: dto.enabled,
    evaluationRules: normalizeString(dto.evaluationRules),
    pauses: dto.pauses.map(normalizeAiPause),
    rulesTemplate: normalizeString(dto.rulesTemplate),
    rulesTemplateVersion: Math.max(1, Math.round(normalizeNumber(dto.rulesTemplateVersion, 1))),
    runtime: normalizeAiRuntime(dto.runtime),
    updatedAt: normalizeDate(dto.updatedAt),
  };
}

export function normalizeAiEndpoint(dto: AiEndpointDto): AiEndpoint {
  return {
    baseUrl: normalizeString(dto.baseUrl),
    createdAt: normalizeDate(dto.createdAt),
    enabled: dto.enabled,
    id: dto.id,
    isActive: dto.isActive,
    name: normalizeString(dto.name, 'Endpoint AI'),
    updatedAt: normalizeDate(dto.updatedAt),
  };
}

export function normalizeAiEndpoints(items: AiEndpointDto[]): AiEndpoint[] {
  return items.map(normalizeAiEndpoint);
}

export function normalizeAiEndpointHealth(dto: AiEndpointHealthDto): AiEndpointHealth {
  return {
    checkedAt: normalizeDate(dto.checkedAt),
    endpointId: dto.endpointId,
    latencyMs:
      typeof dto.latencyMs === 'number' && Number.isFinite(dto.latencyMs) ? dto.latencyMs : null,
    message: dto.message,
    reachable: dto.reachable,
    status: typeof dto.status === 'number' && Number.isFinite(dto.status) ? dto.status : null,
    version: dto.version,
  };
}

export function normalizeAiModel(dto: AiModelDto): AiModel {
  return {
    createdAt: normalizeDate(dto.createdAt),
    discoveredAt: normalizeDate(dto.discoveredAt),
    endpointId: dto.endpointId,
    endpointName: normalizeString(dto.endpointName, 'Endpoint AI'),
    id: dto.id,
    installed: dto.installed,
    name: normalizeString(dto.name, 'Modello AI'),
    updatedAt: normalizeDate(dto.updatedAt),
  };
}

export function normalizeAiModels(items: AiModelDto[]): AiModel[] {
  return items.map(normalizeAiModel);
}

export function normalizeAiModelInstall(dto: AiModelInstallDto): AiModelInstallResult {
  return {
    activity: normalizeActivity(dto.activity),
    model: normalizeAiModel(dto.model),
  };
}

export function validateAiEndpointDraft(input: { baseUrl: string; name: string }): string | null {
  if (!input.name.trim()) {
    return 'Il nome endpoint e obbligatorio';
  }

  if (!input.baseUrl.trim()) {
    return 'La base URL e obbligatoria';
  }

  try {
    new URL(input.baseUrl.trim());
  } catch {
    return 'La base URL deve essere valida';
  }

  return null;
}

export function validateAiModelName(modelName: string): string | null {
  if (!modelName.trim()) {
    return 'Il nome modello e obbligatorio';
  }

  return null;
}
