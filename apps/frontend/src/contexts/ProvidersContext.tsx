import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  debugLinkedInHar as debugLinkedInHarRequest,
  fetchLinkedInSessions,
  uploadLinkedInHar as uploadLinkedInHarRequest,
} from '../API/linkedin';
import {
  createProviderCredentials,
  deleteProviderSession,
  fetchProviders,
  verifyProviderSession,
} from '../API/providers';
import type {
  LinkedInHarDebug,
  ProviderDescriptor,
  ProviderSession,
  SessionVerification,
} from '../models/search';
import {
  normalizeHarDebug,
  normalizeProviderDescriptor,
  normalizeProviderSession,
  normalizeProviderSessions,
  normalizeSessionVerification,
} from '../services/searchService';

const LINKEDIN_PROVIDER_KEY = 'linkedin';

interface ProvidersContextValue {
  debugHar: (harText: string) => Promise<LinkedInHarDebug | null>;
  deleteSession: (sessionId: string) => Promise<boolean>;
  descriptor: ProviderDescriptor | null;
  loadDescriptor: () => Promise<void>;
  loadSessions: (force?: boolean) => Promise<void>;
  loadingSessions: boolean;
  saveCredentials: (
    credentials: Record<string, string>,
    label?: string | undefined,
  ) => Promise<ProviderSession | null>;
  sessionError: string | null;
  sessions: ProviderSession[];
  uploadHar: (harText: string, label?: string | undefined) => Promise<ProviderSession | null>;
  verifySession: (sessionId: string) => Promise<SessionVerification | null>;
}

const ProvidersContext = createContext<ProvidersContextValue | undefined>(undefined);

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

export function ProvidersProvider({ children }: { children: ReactNode }) {
  const [descriptor, setDescriptor] = useState<ProviderDescriptor | null>(null);
  const [sessions, setSessions] = useState<ProviderSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const sessionsInFlightRef = useRef<Promise<void> | null>(null);

  const loadDescriptor = useCallback(async () => {
    try {
      const response = await fetchProviders();
      const linkedin = response.data.find((provider) => provider.key === LINKEDIN_PROVIDER_KEY);
      setDescriptor(linkedin ? normalizeProviderDescriptor(linkedin) : null);
    } catch (caught: unknown) {
      setSessionError(readErrorMessage(caught));
    }
  }, []);

  const loadSessions = useCallback(async (force = false) => {
    if (sessionsInFlightRef.current && !force) {
      return sessionsInFlightRef.current;
    }

    const request = fetchLinkedInSessions()
      .then((response) => {
        setSessions(normalizeProviderSessions(response.data));
        setSessionError(null);
      })
      .catch((caught: unknown) => {
        setSessionError(readErrorMessage(caught));
      })
      .finally(() => {
        setLoadingSessions(false);
        sessionsInFlightRef.current = null;
      });

    setLoadingSessions(true);
    sessionsInFlightRef.current = request;
    return request;
  }, []);

  const saveCredentials = useCallback(
    async (credentials: Record<string, string>, label?: string) => {
      try {
        const response = await createProviderCredentials(LINKEDIN_PROVIDER_KEY, {
          credentials,
          label,
        });
        const session = normalizeProviderSession(response.data);
        setSessions((items) => [session, ...items]);
        setSessionError(null);
        return session;
      } catch (caught: unknown) {
        setSessionError(readErrorMessage(caught));
        return null;
      }
    },
    [],
  );

  const uploadHar = useCallback(async (harText: string, label?: string) => {
    try {
      const response = await uploadLinkedInHarRequest({ harText, label });
      const session = normalizeProviderSession(response.data);
      setSessions((items) => [session, ...items]);
      setSessionError(null);
      return session;
    } catch (caught: unknown) {
      setSessionError(readErrorMessage(caught));
      return null;
    }
  }, []);

  const debugHar = useCallback(async (harText: string) => {
    try {
      const response = await debugLinkedInHarRequest({ harText });
      setSessionError(null);
      return normalizeHarDebug(response.data);
    } catch (caught: unknown) {
      setSessionError(readErrorMessage(caught));
      return null;
    }
  }, []);

  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await deleteProviderSession(LINKEDIN_PROVIDER_KEY, sessionId);
      setSessions((items) => items.filter((item) => item.id !== sessionId));
      setSessionError(null);
      return true;
    } catch (caught: unknown) {
      setSessionError(readErrorMessage(caught));
      return false;
    }
  }, []);

  const verifySession = useCallback(async (sessionId: string) => {
    try {
      const response = await verifyProviderSession(LINKEDIN_PROVIDER_KEY, sessionId);
      const verification = normalizeSessionVerification(response.data);
      if (verification.session) {
        const updated = verification.session;
        setSessions((items) => items.map((item) => (item.id === updated.id ? updated : item)));
      }
      setSessionError(null);
      return verification;
    } catch (caught: unknown) {
      setSessionError(readErrorMessage(caught));
      return null;
    }
  }, []);

  const value = useMemo(
    () => ({
      debugHar,
      deleteSession,
      descriptor,
      loadDescriptor,
      loadSessions,
      loadingSessions,
      saveCredentials,
      sessionError,
      sessions,
      uploadHar,
      verifySession,
    }),
    [
      debugHar,
      deleteSession,
      descriptor,
      loadDescriptor,
      loadSessions,
      loadingSessions,
      saveCredentials,
      sessionError,
      sessions,
      uploadHar,
      verifySession,
    ],
  );

  return <ProvidersContext.Provider value={value}>{children}</ProvidersContext.Provider>;
}

export function useProviders(): ProvidersContextValue {
  const value = useContext(ProvidersContext);
  if (!value) {
    throw new Error('useProviders must be used inside ProvidersProvider');
  }

  return value;
}
