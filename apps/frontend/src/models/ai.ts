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
  daysOfWeek: number[];
  enabled: boolean;
  endTime: string;
  startTime: string;
}

export type AiReviewOutputLanguage = 'en' | 'it' | 'job_language' | 'profile_language';

export interface AiReviewField {
  description: string;
  enabled: boolean;
  key: string;
  label: string;
  maxItems: number;
}

export interface AiSettings {
  activeEndpointId: string | null;
  candidateProfile: string;
  enabled: boolean;
  evaluationRules: string;
  outputLanguage: AiReviewOutputLanguage;
  pauses: AiPauseWindow[];
  reviewFields: AiReviewField[];
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

export const aiReviewOutputLanguageOptions: Array<{
  label: string;
  value: AiReviewOutputLanguage;
}> = [
  { label: 'Italiano', value: 'it' },
  { label: 'English', value: 'en' },
  { label: "Lingua dell'offerta", value: 'job_language' },
  { label: 'Lingua del profilo', value: 'profile_language' },
];

export const defaultAiReviewFields: AiReviewField[] = [
  {
    description: 'Only true deal-breakers.',
    enabled: true,
    key: 'blockers',
    label: 'Bloccanti',
    maxItems: 3,
  },
  {
    description: 'Direct matches between the candidate profile and the offer.',
    enabled: true,
    key: 'matching_points',
    label: 'Punti di match',
    maxItems: 3,
  },
  {
    description:
      'Optional or preferred items explicitly mentioned in the offer and present in the profile.',
    enabled: true,
    key: 'explicit_optional_matches',
    label: 'Match opzionali',
    maxItems: 3,
  },
  {
    description: 'Only missing mandatory or core requirements.',
    enabled: true,
    key: 'mandatory_gaps',
    label: 'Gap obbligatori',
    maxItems: 3,
  },
  {
    description: 'Real but non-blocking concerns, weak evidence or partial fit.',
    enabled: true,
    key: 'caution_notes',
    label: 'Note di attenzione',
    maxItems: 3,
  },
];

export const defaultAiReviewFieldKeys = new Set(defaultAiReviewFields.map((field) => field.key));

export function getAiPauseDayLabel(dayOfWeek: number): string {
  return aiPauseDayOptions.find((option) => option.value === dayOfWeek)?.label ?? String(dayOfWeek);
}

export function getAiPauseDaysLabel(daysOfWeek: number[]): string {
  const days = Array.from(new Set(daysOfWeek)).sort((left, right) => left - right);

  if (days.length === 7) {
    return 'Tutti i giorni';
  }

  if (days.length === 5 && days.every((day, index) => day === index + 1)) {
    return 'Lunedi-Venerdi';
  }

  return days.map(getAiPauseDayLabel).join(', ');
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
