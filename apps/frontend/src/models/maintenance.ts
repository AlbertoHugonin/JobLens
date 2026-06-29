import type { Activity } from './activity';
import type { AiModel } from './ai';

export interface AiModelMetrics {
  avgDurationMs: number | null;
  avgOutputTokens: number | null;
  avgPromptTokens: number | null;
  avgScore: number | null;
  avgTokensPerSecond: number | null;
  endpointId: string | null;
  endpointName: string | null;
  failedCount: number;
  lastReviewedAt: Date;
  modelName: string;
  reviewCount: number;
  successCount: number;
}

export interface AiBenchmarkResult {
  model: AiModel;
  queued: Activity[];
  totalJobs: number;
}

export interface DeleteAiReviewsResult {
  deleted: number;
}
