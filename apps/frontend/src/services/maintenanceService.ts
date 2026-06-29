import type { AiBenchmarkDto, AiModelMetricsDto, DeleteAiReviewsDto } from '../API/ai';
import type {
  AiBenchmarkResult,
  AiModelMetrics,
  DeleteAiReviewsResult,
} from '../models/maintenance';
import { normalizeActivity } from './activityService';
import { normalizeAiModel } from './aiService';

function normalizeDate(value: string): Date {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function normalizeNullableNumber(value: number | null): number | null {
  return value !== null && Number.isFinite(value) ? value : null;
}

export function normalizeAiModelMetrics(dto: AiModelMetricsDto): AiModelMetrics {
  return {
    avgDurationMs: normalizeNullableNumber(dto.avgDurationMs),
    avgOutputTokens: normalizeNullableNumber(dto.avgOutputTokens),
    avgPromptTokens: normalizeNullableNumber(dto.avgPromptTokens),
    avgScore: normalizeNullableNumber(dto.avgScore),
    avgTokensPerSecond: normalizeNullableNumber(dto.avgTokensPerSecond),
    endpointId: dto.endpointId,
    endpointName: dto.endpointName?.trim() || null,
    failedCount: Number.isFinite(dto.failedCount) ? dto.failedCount : 0,
    lastReviewedAt: normalizeDate(dto.lastReviewedAt),
    modelName: dto.modelName.trim() || 'Modello',
    reviewCount: Number.isFinite(dto.reviewCount) ? dto.reviewCount : 0,
    successCount: Number.isFinite(dto.successCount) ? dto.successCount : 0,
  };
}

export function normalizeAiModelMetricsList(items: AiModelMetricsDto[]): AiModelMetrics[] {
  return items.map(normalizeAiModelMetrics);
}

export function normalizeAiBenchmark(dto: AiBenchmarkDto): AiBenchmarkResult {
  return {
    model: normalizeAiModel(dto.model),
    queued: dto.queued.map(normalizeActivity),
    totalJobs: Number.isFinite(dto.totalJobs) ? dto.totalJobs : dto.queued.length,
  };
}

export function normalizeDeleteAiReviews(dto: DeleteAiReviewsDto): DeleteAiReviewsResult {
  return {
    deleted: Number.isFinite(dto.deleted) ? dto.deleted : 0,
  };
}
