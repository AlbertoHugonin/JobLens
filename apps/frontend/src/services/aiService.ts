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
  AiReviewField,
  AiReviewOutputLanguage,
  AiRuntimeSettings,
  AiSettings,
} from '../models/ai';
import { defaultAiReviewFields } from '../models/ai';
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
const REVIEW_OUTPUT_LANGUAGES = new Set<AiReviewOutputLanguage>([
  'en',
  'it',
  'job_language',
  'profile_language',
]);
const RESERVED_REVIEW_FIELD_KEYS = new Set([
  'decision',
  'diagnostic',
  'location_fit',
  'missing_skills',
  'optional_strengths',
  'reason',
  'score',
  'seniority_fit',
  'skill_fit',
]);

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

function normalizeReviewOutputLanguage(value: string): AiReviewOutputLanguage {
  return REVIEW_OUTPUT_LANGUAGES.has(value as AiReviewOutputLanguage)
    ? (value as AiReviewOutputLanguage)
    : 'it';
}

export function normalizeReviewFieldKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function humanizeReviewFieldKey(key: string): string {
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeAiReviewFields(items: unknown): AiReviewField[] {
  if (!Array.isArray(items)) {
    return defaultAiReviewFields.map((field) => ({ ...field }));
  }

  const seen = new Set<string>();
  const fields = items
    .filter((item): item is Partial<AiReviewField> => typeof item === 'object' && item !== null)
    .map((item) => {
      const key = normalizeReviewFieldKey(typeof item.key === 'string' ? item.key : '');
      if (
        !key ||
        key.length < 2 ||
        !/^[a-z][a-z0-9_]*$/.test(key) ||
        RESERVED_REVIEW_FIELD_KEYS.has(key) ||
        seen.has(key)
      ) {
        return null;
      }

      seen.add(key);
      return {
        description:
          typeof item.description === 'string' ? item.description.trim().slice(0, 500) : '',
        enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
        key,
        label:
          typeof item.label === 'string' && item.label.trim()
            ? item.label.trim().slice(0, 80)
            : humanizeReviewFieldKey(key),
        maxItems: Math.max(
          1,
          Math.min(
            10,
            Math.round(
              typeof item.maxItems === 'number' && Number.isFinite(item.maxItems)
                ? item.maxItems
                : 3,
            ),
          ),
        ),
      };
    })
    .filter((item): item is AiReviewField => item !== null);

  return fields.length > 0 ? fields : defaultAiReviewFields.map((field) => ({ ...field }));
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
    outputLanguage: normalizeReviewOutputLanguage(dto.outputLanguage),
    pauses: dto.pauses.map(normalizeAiPause),
    reviewFields: normalizeAiReviewFields(dto.reviewFields),
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
