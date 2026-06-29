import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import {
  cancelActivityQueue as cancelActivityQueueRequest,
  cancelActivity as cancelActivityRequest,
  createActivity,
  fetchActivities,
  fetchActivity,
  fetchActivityLinkedInDebug,
  fetchActivityLogs,
  fetchActivitySummary,
  retryActivity as retryActivityRequest,
} from '../API/activities';
import {
  createDefaultActivityFilters,
  isLinkedInActivity,
  type Activity,
  type ActivityDashboardSummary,
  type ActivityFilters,
  type ActivityLog,
  type LinkedInActivityDebug,
} from '../models/activity';
import {
  normalizeActivityDashboardSummary,
  normalizeActivity,
  normalizeActivityList,
  normalizeActivityLogs,
  normalizeActivityQueueCancellation,
  normalizeLinkedInActivityDebug,
} from '../services/activityService';
import { useAppStatus } from './AppStatusContext';

const PAGE_SIZE = 10;
const LOG_LIMIT = 100;

interface LoadOptions {
  force?: boolean | undefined;
  offset?: number | undefined;
  silent?: boolean | undefined;
}

interface ActivitiesContextValue {
  activities: Activity[];
  cancelActivity: (id: string) => Promise<void>;
  cancelQueue: () => Promise<void>;
  cancellingQueue: boolean;
  createDummyActivity: () => Promise<void>;
  creating: boolean;
  error: string | null;
  filters: ActivityFilters;
  limit: number;
  loadActivities: (options?: LoadOptions) => Promise<void>;
  loadSummary: () => Promise<void>;
  loadingActivities: boolean;
  loadingLinkedInDebug: boolean;
  loadingLogs: boolean;
  loadingSelected: boolean;
  logs: ActivityLog[];
  linkedinDebug: LinkedInActivityDebug | null;
  linkedinDebugError: string | null;
  logsError: string | null;
  mutatingId: string | null;
  offset: number;
  queueNotice: string | null;
  refreshLive: () => Promise<void>;
  retryActivity: (id: string) => Promise<void>;
  selectedActivity: Activity | undefined;
  selectedId: string | null;
  selectActivity: (id: string) => void;
  setFilters: (filters: ActivityFilters) => void;
  setPageOffset: (offset: number) => Promise<void>;
  summary: ActivityDashboardSummary | null;
  total: number;
}

const ActivitiesContext = createContext<ActivitiesContextValue | undefined>(undefined);

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

function replaceActivity(items: Activity[], activity: Activity): Activity[] {
  return items.map((item) => (item.id === activity.id ? activity : item));
}

export function ActivitiesProvider({ children }: { children: ReactNode }) {
  const { loadActivityPreview } = useAppStatus();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [selectedActivity, setSelectedActivity] = useState<Activity | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [linkedinDebug, setLinkedInDebug] = useState<LinkedInActivityDebug | null>(null);
  const [filters, setFiltersState] = useState<ActivityFilters>(() =>
    createDefaultActivityFilters(),
  );
  const [summary, setSummary] = useState<ActivityDashboardSummary | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [queueNotice, setQueueNotice] = useState<string | null>(null);
  const [linkedinDebugError, setLinkedInDebugError] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [loadingLinkedInDebug, setLoadingLinkedInDebug] = useState(false);
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [creating, setCreating] = useState(false);
  const [cancellingQueue, setCancellingQueue] = useState(false);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const loadActivities = useCallback(
    async (options: LoadOptions = {}) => {
      const pageOffset = options.offset ?? offset;

      if (!options.silent) {
        setLoadingActivities(true);
      }

      try {
        const response = await fetchActivities({
          limit: PAGE_SIZE,
          offset: pageOffset,
          status: filters.status || undefined,
          type: filters.type.trim() || undefined,
        });
        const normalized = normalizeActivityList(
          response.data,
          response.meta?.total ?? response.data.length,
        );

        setActivities(normalized.items);
        setTotal(normalized.total);
        setOffset(pageOffset);
        setError(null);

        if (!selectedId && normalized.items[0]) {
          setSelectedId(normalized.items[0].id);
        }

        if (selectedId) {
          const match = normalized.items.find((activity) => activity.id === selectedId);
          if (match) {
            setSelectedActivity(match);
          }
        }
      } catch (caught: unknown) {
        setError(readErrorMessage(caught));
      } finally {
        if (!options.silent) {
          setLoadingActivities(false);
        }
      }
    },
    [filters, offset, selectedId],
  );

  const loadSummary = useCallback(async () => {
    try {
      const response = await fetchActivitySummary(5);
      setSummary(normalizeActivityDashboardSummary(response.data));
      setError(null);
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
    }
  }, []);

  const loadSelectedActivity = useCallback(async (id: string, options: LoadOptions = {}) => {
    if (!options.silent) {
      setLoadingSelected(true);
    }

    try {
      const response = await fetchActivity(id);
      const normalized = normalizeActivity(response.data);
      setSelectedActivity(normalized);
      setActivities((items) => replaceActivity(items, normalized));
      setError(null);
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
    } finally {
      if (!options.silent) {
        setLoadingSelected(false);
      }
    }
  }, []);

  const loadLogs = useCallback(async (id: string, options: LoadOptions = {}) => {
    if (!options.silent) {
      setLoadingLogs(true);
    }

    try {
      const response = await fetchActivityLogs(id, { limit: LOG_LIMIT, offset: 0 });
      setLogs(normalizeActivityLogs(response.data));
      setLogsError(null);
    } catch (caught: unknown) {
      setLogsError(readErrorMessage(caught));
    } finally {
      if (!options.silent) {
        setLoadingLogs(false);
      }
    }
  }, []);

  const loadLinkedInDebug = useCallback(async (id: string, options: LoadOptions = {}) => {
    if (!options.silent) {
      setLoadingLinkedInDebug(true);
    }

    try {
      const response = await fetchActivityLinkedInDebug(id, 20);
      setLinkedInDebug(normalizeLinkedInActivityDebug(response.data));
      setLinkedInDebugError(null);
    } catch (caught: unknown) {
      setLinkedInDebug(null);
      setLinkedInDebugError(readErrorMessage(caught));
    } finally {
      if (!options.silent) {
        setLoadingLinkedInDebug(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setSelectedActivity(undefined);
      setLogs([]);
      setLinkedInDebug(null);
      setLinkedInDebugError(null);
      return;
    }

    void loadSelectedActivity(selectedId);
    void loadLogs(selectedId);
  }, [loadLogs, loadSelectedActivity, selectedId]);

  useEffect(() => {
    if (!selectedActivity || selectedActivity.id !== selectedId) {
      return;
    }

    if (!isLinkedInActivity(selectedActivity)) {
      setLinkedInDebug(null);
      setLinkedInDebugError(null);
      return;
    }

    void loadLinkedInDebug(selectedActivity.id);
  }, [loadLinkedInDebug, selectedActivity, selectedId]);

  const setPageOffset = useCallback(
    async (nextOffset: number) => {
      const boundedOffset = Math.max(0, nextOffset);
      await loadActivities({ force: true, offset: boundedOffset });
    },
    [loadActivities],
  );

  const selectActivity = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const setFilters = useCallback((nextFilters: ActivityFilters) => {
    setFiltersState(nextFilters);
    setOffset(0);
  }, []);

  const refreshLive = useCallback(async () => {
    await Promise.all([loadActivities({ silent: true }), loadSummary()]);

    if (selectedId) {
      const selectedDebugRefresh =
        selectedActivity && isLinkedInActivity(selectedActivity)
          ? loadLinkedInDebug(selectedId, { silent: true })
          : Promise.resolve();

      await Promise.all([
        loadSelectedActivity(selectedId, { silent: true }),
        loadLogs(selectedId, { silent: true }),
        selectedDebugRefresh,
      ]);
    }

    await loadActivityPreview(true);
  }, [
    loadActivities,
    loadActivityPreview,
    loadLogs,
    loadLinkedInDebug,
    loadSelectedActivity,
    loadSummary,
    selectedActivity,
    selectedId,
  ]);

  const createDummyActivity = useCallback(async () => {
    setCreating(true);

    try {
      const response = await createActivity({
        payload: { requestedBy: 'frontend' },
        type: 'dummy',
      });
      const activity = normalizeActivity(response.data);
      setSelectedId(activity.id);
      setSelectedActivity(activity);
      setLogs([]);
      setLinkedInDebug(null);
      setLinkedInDebugError(null);
      await Promise.all([
        loadActivities({ force: true, offset: 0 }),
        loadSummary(),
        loadLogs(activity.id, { silent: true }),
        loadActivityPreview(true),
      ]);
      setError(null);
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
    } finally {
      setCreating(false);
    }
  }, [loadActivities, loadActivityPreview, loadLogs, loadSummary]);

  const cancelActivity = useCallback(
    async (id: string) => {
      setMutatingId(id);

      try {
        const response = await cancelActivityRequest(id);
        const activity = normalizeActivity(response.data);
        setSelectedActivity(activity);
        setActivities((items) => replaceActivity(items, activity));
        await Promise.all([
          loadActivities({ force: true, silent: true }),
          loadSummary(),
          loadLogs(id, { silent: true }),
          loadActivityPreview(true),
        ]);
        setError(null);
      } catch (caught: unknown) {
        setError(readErrorMessage(caught));
      } finally {
        setMutatingId(null);
      }
    },
    [loadActivities, loadActivityPreview, loadLogs, loadSummary],
  );

  const retryActivity = useCallback(
    async (id: string) => {
      setMutatingId(id);

      try {
        const response = await retryActivityRequest(id);
        const activity = normalizeActivity(response.data);
        setSelectedActivity(activity);
        setActivities((items) => replaceActivity(items, activity));
        await Promise.all([
          loadActivities({ force: true, offset: 0, silent: true }),
          loadSummary(),
          loadLogs(id, { silent: true }),
          loadActivityPreview(true),
        ]);
        setError(null);
      } catch (caught: unknown) {
        setError(readErrorMessage(caught));
      } finally {
        setMutatingId(null);
      }
    },
    [loadActivities, loadActivityPreview, loadLogs, loadSummary],
  );

  const cancelQueue = useCallback(async () => {
    setCancellingQueue(true);
    setQueueNotice(null);

    try {
      const response = await cancelActivityQueueRequest({
        source: filters.source.trim() || undefined,
        type: filters.type.trim() || undefined,
      });
      const result = normalizeActivityQueueCancellation(response.data);
      setQueueNotice(
        `Coda aggiornata: ${result.cancelled} annullate, ${result.requested} richieste.`,
      );
      await Promise.all([
        loadActivities({ force: true, offset: 0, silent: true }),
        loadSummary(),
        loadActivityPreview(true),
      ]);

      if (selectedId) {
        const selectedDebugRefresh =
          selectedActivity && isLinkedInActivity(selectedActivity)
            ? loadLinkedInDebug(selectedId, { silent: true })
            : Promise.resolve();

        await Promise.all([
          loadSelectedActivity(selectedId, { silent: true }),
          loadLogs(selectedId, { silent: true }),
          selectedDebugRefresh,
        ]);
      }

      setError(null);
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
    } finally {
      setCancellingQueue(false);
    }
  }, [
    filters.type,
    filters.source,
    loadActivities,
    loadActivityPreview,
    loadLinkedInDebug,
    loadLogs,
    loadSelectedActivity,
    loadSummary,
    selectedActivity,
    selectedId,
  ]);

  const value = useMemo(
    () => ({
      activities,
      cancelActivity,
      cancelQueue,
      cancellingQueue,
      createDummyActivity,
      creating,
      error,
      filters,
      limit: PAGE_SIZE,
      loadActivities,
      loadSummary,
      loadingActivities,
      loadingLinkedInDebug,
      loadingLogs,
      loadingSelected,
      logs,
      linkedinDebug,
      linkedinDebugError,
      logsError,
      mutatingId,
      offset,
      queueNotice,
      refreshLive,
      retryActivity,
      selectedActivity,
      selectedId,
      selectActivity,
      setFilters,
      setPageOffset,
      summary,
      total,
    }),
    [
      activities,
      cancelActivity,
      cancelQueue,
      cancellingQueue,
      createDummyActivity,
      creating,
      error,
      filters,
      loadActivities,
      loadSummary,
      loadingActivities,
      loadingLinkedInDebug,
      loadingLogs,
      loadingSelected,
      logs,
      linkedinDebug,
      linkedinDebugError,
      logsError,
      mutatingId,
      offset,
      queueNotice,
      refreshLive,
      retryActivity,
      selectedActivity,
      selectedId,
      selectActivity,
      setFilters,
      setPageOffset,
      summary,
      total,
    ],
  );

  return <ActivitiesContext.Provider value={value}>{children}</ActivitiesContext.Provider>;
}

export function useActivities(): ActivitiesContextValue {
  const value = useContext(ActivitiesContext);
  if (!value) {
    throw new Error('useActivities must be used inside ActivitiesProvider');
  }

  return value;
}
