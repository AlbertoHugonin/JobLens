import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { fetchLinkedInGeoTypeahead } from '../API/linkedin';
import { fetchActivities } from '../API/activities';
import {
  createSearch as createSearchRequest,
  deleteSearch as deleteSearchRequest,
  fetchSearches,
  importSearchUrl,
  previewSearchUrl,
  runSearches as runSearchesRequest,
  runSearch as runSearchRequest,
  updateSearch as updateSearchRequest,
} from '../API/searches';
import type { Activity } from '../models/activity';
import type {
  LinkedInGeoHit,
  LinkedInSearchDraft,
  Search,
  SearchPreview,
} from '../models/search';
import { normalizeActivity } from '../services/activityService';
import {
  draftToLinkedInQueryInput,
  normalizeGeoHits,
  normalizeSearch,
  normalizeSearchList,
  normalizeSearchPreview,
  validateLinkedInSearchDraft,
} from '../services/searchService';

interface SearchesContextValue {
  deleteSearch: (id: string) => Promise<void>;
  error: string | null;
  geoError: string | null;
  geoHits: LinkedInGeoHit[];
  importUrl: (url: string) => Promise<SearchPreview | null>;
  loadRuns: (searchId: string, force?: boolean) => Promise<void>;
  loadSearches: (force?: boolean) => Promise<void>;
  loading: boolean;
  preview: SearchPreview | null;
  previewDraft: (draft: LinkedInSearchDraft) => Promise<SearchPreview | null>;
  runAllSearches: () => Promise<void>;
  runningAll: boolean;
  runSearch: (id: string) => Promise<Activity | null>;
  runNotice: string | null;
  runs: Activity[];
  saveDraft: (draft: LinkedInSearchDraft, id?: string | undefined) => Promise<Search | null>;
  searchGeo: (query: string) => Promise<void>;
  searches: Search[];
  selectedId: string | null;
  selectSearch: (id: string | null) => void;
  total: number;
}

const SearchesContext = createContext<SearchesContextValue | undefined>(undefined);

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

function replaceSearch(items: Search[], search: Search): Search[] {
  const exists = items.some((item) => item.id === search.id);
  if (!exists) {
    return [search, ...items];
  }

  return items.map((item) => (item.id === search.id ? search : item));
}

export function SearchesProvider({ children }: { children: ReactNode }) {
  const [searches, setSearches] = useState<Search[]>([]);
  const [geoHits, setGeoHits] = useState<LinkedInGeoHit[]>([]);
  const [preview, setPreview] = useState<SearchPreview | null>(null);
  const [runs, setRuns] = useState<Activity[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [runNotice, setRunNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const searchesInFlightRef = useRef<Promise<void> | null>(null);
  const runsInFlightRef = useRef<Promise<void> | null>(null);
  const selectionInitializedRef = useRef(false);

  const loadSearches = useCallback(async (force = false) => {
    if (searchesInFlightRef.current && !force) {
      return searchesInFlightRef.current;
    }

    const request = fetchSearches({ limit: 50, offset: 0, providerKey: 'linkedin' })
      .then((response) => {
        const normalized = normalizeSearchList(
          response.data,
          response.meta?.total ?? response.data.length,
        );
        setSearches(normalized.items);
        setTotal(normalized.total);
        setError(null);
        setSelectedId((current) => {
          if (current) {
            return current;
          }

          if (!selectionInitializedRef.current) {
            selectionInitializedRef.current = true;
            return normalized.items[0]?.id ?? null;
          }

          return null;
        });
      })
      .catch((caught: unknown) => {
        setError(readErrorMessage(caught));
      })
      .finally(() => {
        setLoading(false);
        searchesInFlightRef.current = null;
      });

    setLoading(true);
    searchesInFlightRef.current = request;
    return request;
  }, []);

  const loadRuns = useCallback(async (searchId: string, force = false) => {
    if (runsInFlightRef.current && !force) {
      return runsInFlightRef.current;
    }

    const request = fetchActivities({
      limit: 5,
      offset: 0,
      subjectId: searchId,
      subjectType: 'search',
      type: 'linkedin_collect',
    })
      .then((response) => {
        setRuns(response.data.map(normalizeActivity));
        setError(null);
      })
      .catch((caught: unknown) => {
        setError(readErrorMessage(caught));
      })
      .finally(() => {
        runsInFlightRef.current = null;
      });

    runsInFlightRef.current = request;
    return request;
  }, []);

  const searchGeo = useCallback(async (query: string) => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      setGeoHits([]);
      setGeoError(null);
      return;
    }

    try {
      const response = await fetchLinkedInGeoTypeahead(normalizedQuery);
      setGeoHits(normalizeGeoHits(response.data).slice(0, 8));
      setGeoError(null);
    } catch (caught: unknown) {
      setGeoHits([]);
      setGeoError(readErrorMessage(caught));
    }
  }, []);

  const previewDraft = useCallback(async (draft: LinkedInSearchDraft) => {
    const validationError = validateLinkedInSearchDraft(draft);
    if (validationError) {
      setError(validationError);
      return null;
    }

    try {
      const response = await previewSearchUrl({
        providerKey: 'linkedin',
        query: draftToLinkedInQueryInput(draft),
      });
      const normalized = normalizeSearchPreview(response.data);
      setPreview(normalized);
      setError(null);
      return normalized;
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
      return null;
    }
  }, []);

  const importUrl = useCallback(async (url: string) => {
    try {
      const response = await importSearchUrl({
        providerKey: 'linkedin',
        url: url.trim(),
      });
      const normalized = normalizeSearchPreview(response.data);
      setPreview(normalized);
      setError(null);
      return normalized;
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
      return null;
    }
  }, []);

  const saveDraft = useCallback(async (draft: LinkedInSearchDraft, id?: string) => {
    const validationError = validateLinkedInSearchDraft(draft);
    if (validationError) {
      setError(validationError);
      return null;
    }

    const input = {
      enabled: draft.enabled,
      name: draft.name.trim(),
      query: draftToLinkedInQueryInput(draft),
      scheduleConfig: draft.scheduleConfig,
    };

    try {
      const response = id
        ? await updateSearchRequest(id, input)
        : await createSearchRequest({
            ...input,
            providerKey: 'linkedin',
          });
      const search = normalizeSearch(response.data);

      setSearches((items) => replaceSearch(items, search));
      selectionInitializedRef.current = true;
      setSelectedId(search.id);
      setPreview({ query: search.query, url: search.query.publicUrl });
      setError(null);
      return search;
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
      return null;
    }
  }, []);

  const runSearch = useCallback(
    async (id: string) => {
      try {
        const response = await runSearchRequest(id);
        const activity = normalizeActivity(response.data);
        setRuns((items) =>
          [activity, ...items.filter((item) => item.id !== activity.id)].slice(0, 5),
        );
        setError(null);
        setRunNotice('Raccolta in coda');
        await loadSearches(true);
        return activity;
      } catch (caught: unknown) {
        setError(readErrorMessage(caught));
        return null;
      }
    },
    [loadSearches],
  );

  const runAllSearches = useCallback(async () => {
    setRunningAll(true);

    try {
      const response = await runSearchesRequest({
        all: true,
        providerKey: 'linkedin',
      });
      const queued = response.data.queued.map(normalizeActivity);
      setRunNotice(`Raccolte in coda: ${queued.length}. Saltate: ${response.data.skipped.length}.`);
      setError(null);
      await loadSearches(true);
      if (selectedId) {
        await loadRuns(selectedId, true);
      }
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
    } finally {
      setRunningAll(false);
    }
  }, [loadRuns, loadSearches, selectedId]);

  const deleteSearch = useCallback(async (id: string) => {
    try {
      await deleteSearchRequest(id);
      setSearches((items) => items.filter((item) => item.id !== id));
      setTotal((value) => Math.max(0, value - 1));
      setSelectedId((current) => (current === id ? null : current));
      setError(null);
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
    }
  }, []);

  const selectSearch = useCallback((id: string | null) => {
    selectionInitializedRef.current = true;
    setSelectedId(id);
    setPreview(null);
    setRuns([]);
    setRunNotice(null);
  }, []);

  const value = useMemo(
    () => ({
      deleteSearch,
      error,
      geoError,
      geoHits,
      importUrl,
      loadRuns,
      loadSearches,
      loading,
      preview,
      previewDraft,
      runAllSearches,
      runningAll,
      runSearch,
      runNotice,
      runs,
      saveDraft,
      searchGeo,
      searches,
      selectedId,
      selectSearch,
      total,
    }),
    [
      deleteSearch,
      error,
      geoError,
      geoHits,
      importUrl,
      loadRuns,
      loadSearches,
      loading,
      preview,
      previewDraft,
      runAllSearches,
      runningAll,
      runSearch,
      runNotice,
      runs,
      saveDraft,
      searchGeo,
      searches,
      selectedId,
      selectSearch,
      total,
    ],
  );

  return <SearchesContext.Provider value={value}>{children}</SearchesContext.Provider>;
}

export function useSearches(): SearchesContextValue {
  const value = useContext(SearchesContext);
  if (!value) {
    throw new Error('useSearches must be used inside SearchesProvider');
  }

  return value;
}
