import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { fetchActivities } from '../API/activities';
import { fetchApiHealth } from '../API/health';
import type { ActivityPreview } from '../models/activity';
import type { ServiceHealth } from '../models/health';
import { normalizeActivityPreview } from '../services/activityService';
import { normalizeApiHealth } from '../services/healthService';

interface AppStatusContextValue {
  apiHealth: ServiceHealth | undefined;
  activityError: string | null;
  activityPreview: ActivityPreview | undefined;
  error: string | null;
  loadActivityPreview: (force?: boolean) => Promise<void>;
  loadApiHealth: (force?: boolean) => Promise<void>;
  loadingActivities: boolean;
  loading: boolean;
}

const AppStatusContext = createContext<AppStatusContextValue | undefined>(undefined);

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

export function AppStatusProvider({ children }: { children: ReactNode }) {
  const [apiHealth, setApiHealth] = useState<ServiceHealth | undefined>(undefined);
  const [activityPreview, setActivityPreview] = useState<ActivityPreview | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const activitiesInFlightRef = useRef<Promise<void> | null>(null);

  const loadApiHealth = useCallback(async (force = false) => {
    if (inFlightRef.current && !force) {
      return inFlightRef.current;
    }

    const request = fetchApiHealth()
      .then((dto) => {
        setApiHealth(normalizeApiHealth(dto));
        setError(null);
      })
      .catch((caught: unknown) => {
        setError(readErrorMessage(caught));
      })
      .finally(() => {
        setLoading(false);
        inFlightRef.current = null;
      });

    setLoading(true);
    inFlightRef.current = request;
    return request;
  }, []);

  const loadActivityPreview = useCallback(async (force = false) => {
    if (activitiesInFlightRef.current && !force) {
      return activitiesInFlightRef.current;
    }

    const request = fetchActivities({ limit: 4, offset: 0 })
      .then((response) => {
        setActivityPreview(
          normalizeActivityPreview(response.data, response.meta?.total ?? response.data.length),
        );
        setActivityError(null);
      })
      .catch((caught: unknown) => {
        setActivityError(readErrorMessage(caught));
      })
      .finally(() => {
        setLoadingActivities(false);
        activitiesInFlightRef.current = null;
      });

    setLoadingActivities(true);
    activitiesInFlightRef.current = request;
    return request;
  }, []);

  const value = useMemo(
    () => ({
      apiHealth,
      activityError,
      activityPreview,
      error,
      loadActivityPreview,
      loadApiHealth,
      loadingActivities,
      loading,
    }),
    [
      apiHealth,
      activityError,
      activityPreview,
      error,
      loadActivityPreview,
      loadApiHealth,
      loadingActivities,
      loading,
    ],
  );

  return <AppStatusContext.Provider value={value}>{children}</AppStatusContext.Provider>;
}

export function useAppStatus(): AppStatusContextValue {
  const value = useContext(AppStatusContext);
  if (!value) {
    throw new Error('useAppStatus must be used inside AppStatusProvider');
  }

  return value;
}
