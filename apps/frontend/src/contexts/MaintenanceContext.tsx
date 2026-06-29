import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  deleteAiReviews as deleteAiReviewsRequest,
  fetchAiModelMetrics,
  runAiBenchmark as runAiBenchmarkRequest,
} from '../API/ai';
import { createDebugBundle, createJobsReviewsExport } from '../API/maintenance';
import type { Activity } from '../models/activity';
import type {
  AiBenchmarkResult,
  AiModelMetrics,
  DeleteAiReviewsResult,
} from '../models/maintenance';
import { normalizeActivity } from '../services/activityService';
import {
  normalizeAiBenchmark,
  normalizeAiModelMetricsList,
  normalizeDeleteAiReviews,
} from '../services/maintenanceService';

interface MaintenanceContextValue {
  createDebugBundle: () => Promise<Activity | null>;
  createJobsReviewsExport: () => Promise<Activity | null>;
  deleteAiReviews: (input: {
    all?: boolean;
    modelName?: string;
  }) => Promise<DeleteAiReviewsResult | null>;
  error: string | null;
  lastActivity: Activity | null;
  lastBenchmark: AiBenchmarkResult | null;
  lastDeletion: DeleteAiReviewsResult | null;
  loadModelMetrics: () => Promise<void>;
  loadingMetrics: boolean;
  metrics: AiModelMetrics[];
  mutating: boolean;
  notice: string | null;
  runBenchmark: (modelName: string) => Promise<AiBenchmarkResult | null>;
}

const MaintenanceContext = createContext<MaintenanceContextValue | undefined>(undefined);

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

export function MaintenanceProvider({ children }: { children: ReactNode }) {
  const [metrics, setMetrics] = useState<AiModelMetrics[]>([]);
  const [lastActivity, setLastActivity] = useState<Activity | null>(null);
  const [lastBenchmark, setLastBenchmark] = useState<AiBenchmarkResult | null>(null);
  const [lastDeletion, setLastDeletion] = useState<DeleteAiReviewsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);

  const loadModelMetrics = useCallback(async () => {
    setLoadingMetrics(true);
    try {
      const response = await fetchAiModelMetrics();
      setMetrics(normalizeAiModelMetricsList(response.data));
      setError(null);
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
    } finally {
      setLoadingMetrics(false);
    }
  }, []);

  const queueActivity = useCallback(
    async (request: () => ReturnType<typeof createDebugBundle>, message: string) => {
      setMutating(true);
      try {
        const response = await request();
        const activity = normalizeActivity(response.data);
        setLastActivity(activity);
        setNotice(message);
        setError(null);
        return activity;
      } catch (caught: unknown) {
        setError(readErrorMessage(caught));
        return null;
      } finally {
        setMutating(false);
      }
    },
    [],
  );

  const createDebugBundleAction = useCallback(
    () => queueActivity(createDebugBundle, 'Bundle debug aggiunto alla coda'),
    [queueActivity],
  );

  const createJobsReviewsExportAction = useCallback(
    () => queueActivity(createJobsReviewsExport, 'Export JSONL aggiunto alla coda'),
    [queueActivity],
  );

  const runBenchmark = useCallback(
    async (modelName: string) => {
      setMutating(true);
      try {
        const response = await runAiBenchmarkRequest({ modelName });
        const benchmark = normalizeAiBenchmark(response.data);
        setLastBenchmark(benchmark);
        setNotice(`Benchmark accodato: ${benchmark.queued.length} review`);
        setError(null);
        await loadModelMetrics();
        return benchmark;
      } catch (caught: unknown) {
        setError(readErrorMessage(caught));
        return null;
      } finally {
        setMutating(false);
      }
    },
    [loadModelMetrics],
  );

  const deleteAiReviews = useCallback(
    async (input: { all?: boolean; modelName?: string }) => {
      setMutating(true);
      try {
        const response = await deleteAiReviewsRequest(input);
        const deletion = normalizeDeleteAiReviews(response.data);
        setLastDeletion(deletion);
        setNotice(`Review eliminate: ${deletion.deleted}`);
        setError(null);
        await loadModelMetrics();
        return deletion;
      } catch (caught: unknown) {
        setError(readErrorMessage(caught));
        return null;
      } finally {
        setMutating(false);
      }
    },
    [loadModelMetrics],
  );

  const value = useMemo<MaintenanceContextValue>(
    () => ({
      createDebugBundle: createDebugBundleAction,
      createJobsReviewsExport: createJobsReviewsExportAction,
      deleteAiReviews,
      error,
      lastActivity,
      lastBenchmark,
      lastDeletion,
      loadModelMetrics,
      loadingMetrics,
      metrics,
      mutating,
      notice,
      runBenchmark,
    }),
    [
      createDebugBundleAction,
      createJobsReviewsExportAction,
      deleteAiReviews,
      error,
      lastActivity,
      lastBenchmark,
      lastDeletion,
      loadModelMetrics,
      loadingMetrics,
      metrics,
      mutating,
      notice,
      runBenchmark,
    ],
  );

  return <MaintenanceContext.Provider value={value}>{children}</MaintenanceContext.Provider>;
}

export function useMaintenance(): MaintenanceContextValue {
  const value = useContext(MaintenanceContext);
  if (!value) {
    throw new Error('useMaintenance must be used inside MaintenanceProvider');
  }

  return value;
}
