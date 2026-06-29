import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  exportJob as exportJobRequest,
  fetchJob,
  fetchJobReviews,
  fetchJobs,
  requestBatchJobReviews,
  requestJobReview,
  updateJobState,
} from '../API/jobs';
import { fetchSearches } from '../API/searches';
import {
  createDefaultJobFilters,
  type JobDetail,
  type JobExport,
  type JobFilters,
  type JobReviewDetail,
  type JobLocalStatus,
  type JobSummary,
} from '../models/job';
import type { Search } from '../models/search';
import {
  normalizeBatchJobReviewResult,
  normalizeJobDetail,
  normalizeJobExport,
  normalizeJobReviewDetail,
  normalizeJobList,
  normalizeJobSummary,
} from '../services/jobService';
import { normalizeSearchList } from '../services/searchService';

interface LoadJobsOptions {
  force?: boolean | undefined;
}

interface JobsContextValue {
  batchReviewing: boolean;
  error: string | null;
  exportJobJson: (id: string) => Promise<JobExport | null>;
  filters: JobFilters;
  jobs: JobSummary[];
  limit: number;
  loadJobs: (options?: LoadJobsOptions) => Promise<void>;
  loadSearchOptions: () => Promise<void>;
  loadingDetail: boolean;
  loadingReviews: boolean;
  loadingJobs: boolean;
  mutatingId: string | null;
  offset: number;
  requestBatchReviews: () => Promise<void>;
  requestReview: (id: string) => Promise<void>;
  reviewNotice: string | null;
  reviews: JobReviewDetail[];
  reviewsError: string | null;
  reviewingJobId: string | null;
  searchOptions: Search[];
  selectJob: (id: string | null) => Promise<void>;
  selectedId: string | null;
  selectedJob: JobDetail | null;
  setFilters: (filters: Partial<JobFilters>) => void;
  setPageOffset: (offset: number) => void;
  total: number;
  updateLocalStatus: (id: string, localStatus: JobLocalStatus) => Promise<void>;
}

const JobsContext = createContext<JobsContextValue | undefined>(undefined);

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

function toRequestFilters(filters: JobFilters): Parameters<typeof fetchJobs>[0] {
  return {
    availabilityStatus: filters.availabilityStatus || undefined,
    decision: filters.decision.length > 0 ? filters.decision.join(',') : undefined,
    localStatus: filters.localStatus || undefined,
    location: filters.location.trim() || undefined,
    modelName: filters.modelName.trim() || undefined,
    providerKey: filters.providerKey || undefined,
    scope: filters.scope,
    searchId: filters.searchId || undefined,
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
    text: filters.text.trim() || undefined,
    workplace: filters.workplace || undefined,
  };
}

function replaceJobSummary(items: JobSummary[], job: JobSummary): JobSummary[] {
  return items.map((item) => (item.id === job.id ? job : item));
}

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [searchOptions, setSearchOptions] = useState<Search[]>([]);
  const [selectedJob, setSelectedJob] = useState<JobDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFiltersState] = useState<JobFilters>(() => createDefaultJobFilters());
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(25);
  const [error, setError] = useState<string | null>(null);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [reviewingJobId, setReviewingJobId] = useState<string | null>(null);
  const [batchReviewing, setBatchReviewing] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [reviews, setReviews] = useState<JobReviewDetail[]>([]);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [loadingReviews, setLoadingReviews] = useState(false);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const response = await fetchJobs({
        ...toRequestFilters(filters),
        limit,
        offset,
      });
      const normalized = normalizeJobList(
        response.data,
        response.meta?.total ?? response.data.length,
      );
      setJobs(normalized.items);
      setTotal(normalized.total);
      setError(null);
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
    } finally {
      setLoadingJobs(false);
    }
  }, [filters, limit, offset]);

  const loadSearchOptions = useCallback(async () => {
    try {
      const response = await fetchSearches({ limit: 100, offset: 0, providerKey: 'linkedin' });
      setSearchOptions(
        normalizeSearchList(response.data, response.meta?.total ?? response.data.length).items,
      );
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
    }
  }, []);

  const setFilters = useCallback((nextFilters: Partial<JobFilters>) => {
    setFiltersState((current) => ({
      ...current,
      ...nextFilters,
    }));
    setOffset(0);
  }, []);

  const setPageOffset = useCallback((nextOffset: number) => {
    setOffset(Math.max(0, nextOffset));
  }, []);

  const selectJob = useCallback(async (id: string | null) => {
    setSelectedId(id);
    if (!id) {
      setSelectedJob(null);
      setReviews([]);
      setReviewsError(null);
      return;
    }

    setLoadingDetail(true);
    setLoadingReviews(true);
    try {
      const [jobResponse, reviewsResponse] = await Promise.all([fetchJob(id), fetchJobReviews(id)]);
      setSelectedJob(normalizeJobDetail(jobResponse.data));
      setReviews(reviewsResponse.data.map(normalizeJobReviewDetail));
      setReviewsError(null);
      setError(null);
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
      setReviewsError(readErrorMessage(caught));
    } finally {
      setLoadingDetail(false);
      setLoadingReviews(false);
    }
  }, []);

  const updateLocalStatus = useCallback(async (id: string, localStatus: JobLocalStatus) => {
    setMutatingId(id);
    try {
      const response = await updateJobState(id, { localStatus });
      const detail = normalizeJobDetail(response.data);
      setSelectedJob(detail);
      setSelectedId(detail.id);
      setJobs((items) => replaceJobSummary(items, normalizeJobSummary(response.data)));
      setError(null);
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
    } finally {
      setMutatingId(null);
    }
  }, []);

  const exportJobJson = useCallback(async (id: string) => {
    try {
      const response = await exportJobRequest(id);
      setError(null);
      return normalizeJobExport(response.data);
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
      return null;
    }
  }, []);

  const requestReview = useCallback(
    async (id: string) => {
      setReviewingJobId(id);
      try {
        await requestJobReview(id, { mode: 'manual' });
        setReviewNotice('Review AI aggiunta alla coda');
        setError(null);
        if (selectedId === id) {
          await selectJob(id);
        }
        await loadJobs();
      } catch (caught: unknown) {
        setError(readErrorMessage(caught));
      } finally {
        setReviewingJobId(null);
      }
    },
    [loadJobs, selectJob, selectedId],
  );

  const requestBatchReviews = useCallback(async () => {
    const jobIds = jobs.map((job) => job.id);
    if (jobIds.length === 0) {
      return;
    }

    setBatchReviewing(true);
    try {
      const response = await requestBatchJobReviews({
        jobIds,
        mode: 'automatic',
      });
      const result = normalizeBatchJobReviewResult(response.data);
      setReviewNotice(
        `Review batch in coda: ${result.queued.length}. Saltate: ${result.skipped.length}.`,
      );
      setError(null);
      await loadJobs();
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
    } finally {
      setBatchReviewing(false);
    }
  }, [jobs, loadJobs]);

  const value = useMemo<JobsContextValue>(
    () => ({
      batchReviewing,
      error,
      exportJobJson,
      filters,
      jobs,
      limit,
      loadJobs,
      loadSearchOptions,
      loadingDetail,
      loadingJobs,
      mutatingId,
      offset,
      requestBatchReviews,
      requestReview,
      reviewNotice,
      reviews,
      reviewsError,
      reviewingJobId,
      loadingReviews,
      searchOptions,
      selectJob,
      selectedId,
      selectedJob,
      setFilters,
      setPageOffset,
      total,
      updateLocalStatus,
    }),
    [
      batchReviewing,
      error,
      exportJobJson,
      filters,
      jobs,
      limit,
      loadJobs,
      loadSearchOptions,
      loadingDetail,
      loadingJobs,
      mutatingId,
      offset,
      requestBatchReviews,
      requestReview,
      reviewNotice,
      reviews,
      reviewsError,
      reviewingJobId,
      loadingReviews,
      searchOptions,
      selectJob,
      selectedId,
      selectedJob,
      setFilters,
      setPageOffset,
      total,
      updateLocalStatus,
    ],
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs(): JobsContextValue {
  const context = useContext(JobsContext);
  if (!context) {
    throw new Error('useJobs must be used inside JobsProvider');
  }

  return context;
}
