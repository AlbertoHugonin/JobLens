import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  activateAiEndpoint as activateAiEndpointRequest,
  createAiEndpoint as createAiEndpointRequest,
  deleteAiEndpoint as deleteAiEndpointRequest,
  deleteAiModel as deleteAiModelRequest,
  fetchAiEndpointHealth,
  fetchAiEndpoints,
  fetchAiModels,
  fetchAiSettings,
  installAiModel as installAiModelRequest,
  resetAiEvaluationRules,
  syncAiModels as syncAiModelsRequest,
  updateAiEndpoint as updateAiEndpointRequest,
  updateAiSettings as updateAiSettingsRequest,
  type AiEndpointInput,
  type AiEndpointUpdateInput,
  type AiModelInstallInput,
  type AiSettingsUpdateInput,
} from '../API/ai';
import { fetchActivity } from '../API/activities';
import type { Activity } from '../models/activity';
import type {
  AiEndpoint,
  AiEndpointHealth,
  AiModel,
  AiModelInstallResult,
  AiSettings,
} from '../models/ai';
import { isActiveActivity } from '../models/activity';
import {
  normalizeAiEndpoint,
  normalizeAiEndpointHealth,
  normalizeAiEndpoints,
  normalizeAiModelInstall,
  normalizeAiModels,
  normalizeAiSettings,
} from '../services/aiService';
import { normalizeActivity } from '../services/activityService';
import { useAppStatus } from './AppStatusContext';

type LoadModelsInput =
  | boolean
  | {
      endpointId?: string | undefined;
      sync?: boolean | undefined;
    };

interface AiSettingsContextValue {
  activateEndpoint: (id: string) => Promise<AiEndpoint | null>;
  checkEndpointHealth: (id: string) => Promise<AiEndpointHealth | null>;
  createEndpoint: (input: AiEndpointInput) => Promise<AiEndpoint | null>;
  creatingEndpoint: boolean;
  deletingEndpointId: string | null;
  deletingModelId: string | null;
  endpointError: string | null;
  endpointHealth: Record<string, AiEndpointHealth>;
  endpoints: AiEndpoint[];
  error: string | null;
  healthCheckingIds: string[];
  installActivity: Activity | null;
  installModel: (input: AiModelInstallInput) => Promise<AiModelInstallResult | null>;
  installingModel: boolean;
  loadAll: (force?: boolean) => Promise<void>;
  loadEndpoints: (force?: boolean) => Promise<void>;
  loadModels: (input?: LoadModelsInput) => Promise<void>;
  loadSettings: (force?: boolean) => Promise<void>;
  loadingEndpoints: boolean;
  loadingModels: boolean;
  loadingSettings: boolean;
  modelError: string | null;
  models: AiModel[];
  mutatingEndpointId: string | null;
  refreshInstallActivity: () => Promise<void>;
  removeEndpoint: (id: string) => Promise<boolean>;
  removeModel: (id: string) => Promise<boolean>;
  resetRules: () => Promise<AiSettings | null>;
  saveSettings: (input: AiSettingsUpdateInput) => Promise<AiSettings | null>;
  savingSettings: boolean;
  settings: AiSettings | undefined;
  updateEndpoint: (id: string, input: AiEndpointUpdateInput) => Promise<AiEndpoint | null>;
}

const AiSettingsContext = createContext<AiSettingsContextValue | undefined>(undefined);

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

function replaceEndpoint(items: AiEndpoint[], endpoint: AiEndpoint): AiEndpoint[] {
  const exists = items.some((item) => item.id === endpoint.id);
  if (!exists) {
    return [endpoint, ...items];
  }

  return items.map((item) => (item.id === endpoint.id ? endpoint : item));
}

function replaceModel(items: AiModel[], model: AiModel): AiModel[] {
  const exists = items.some((item) => item.id === model.id);
  if (!exists) {
    return [model, ...items];
  }

  return items.map((item) => (item.id === model.id ? model : item));
}

function normalizeLoadModelsInput(input: LoadModelsInput | undefined): {
  endpointId?: string | undefined;
  sync: boolean;
} {
  if (!input || typeof input === 'boolean') {
    return { sync: false };
  }

  return {
    endpointId: input.endpointId?.trim() || undefined,
    sync: input.sync === true,
  };
}

export function AiSettingsProvider({ children }: { children: ReactNode }) {
  const { loadActivityPreview } = useAppStatus();
  const [settings, setSettings] = useState<AiSettings | undefined>(undefined);
  const [endpoints, setEndpoints] = useState<AiEndpoint[]>([]);
  const [models, setModels] = useState<AiModel[]>([]);
  const [endpointHealth, setEndpointHealth] = useState<Record<string, AiEndpointHealth>>({});
  const [healthCheckingIds, setHealthCheckingIds] = useState<string[]>([]);
  const [installActivity, setInstallActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [endpointError, setEndpointError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [creatingEndpoint, setCreatingEndpoint] = useState(false);
  const [installingModel, setInstallingModel] = useState(false);
  const [mutatingEndpointId, setMutatingEndpointId] = useState<string | null>(null);
  const [deletingEndpointId, setDeletingEndpointId] = useState<string | null>(null);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);
  const activeEndpointId = useMemo(
    () => endpoints.find((endpoint) => endpoint.isActive)?.id ?? settings?.activeEndpointId ?? null,
    [endpoints, settings?.activeEndpointId],
  );

  const loadSettings = useCallback(async () => {
    setLoadingSettings(true);
    try {
      const response = await fetchAiSettings();
      setSettings(normalizeAiSettings(response.data));
      setError(null);
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  const loadEndpoints = useCallback(async () => {
    setLoadingEndpoints(true);
    try {
      const response = await fetchAiEndpoints();
      setEndpoints(normalizeAiEndpoints(response.data));
      setEndpointError(null);
    } catch (caught: unknown) {
      setEndpointError(readErrorMessage(caught));
    } finally {
      setLoadingEndpoints(false);
    }
  }, []);

  const loadModels = useCallback(
    async (input?: LoadModelsInput) => {
      const options = normalizeLoadModelsInput(input);
      const endpointId = options.endpointId ?? activeEndpointId ?? undefined;

      setLoadingModels(true);
      try {
        const response =
          options.sync && endpointId
            ? await syncAiModelsRequest({ endpointId })
            : await fetchAiModels(endpointId);
        setModels(normalizeAiModels(response.data));
        setModelError(null);
      } catch (caught: unknown) {
        setModelError(readErrorMessage(caught));
      } finally {
        setLoadingModels(false);
      }
    },
    [activeEndpointId],
  );

  const loadAll = useCallback(async () => {
    await Promise.all([loadSettings(), loadEndpoints(), loadModels()]);
  }, [loadEndpoints, loadModels, loadSettings]);

  const checkEndpointHealth = useCallback(async (id: string) => {
    setHealthCheckingIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    try {
      const response = await fetchAiEndpointHealth(id);
      const health = normalizeAiEndpointHealth(response.data);
      setEndpointHealth((current) => ({ ...current, [id]: health }));
      return health;
    } catch {
      return null;
    } finally {
      setHealthCheckingIds((ids) => ids.filter((item) => item !== id));
    }
  }, []);

  const saveSettings = useCallback(async (input: AiSettingsUpdateInput) => {
    setSavingSettings(true);
    try {
      const response = await updateAiSettingsRequest(input);
      const normalized = normalizeAiSettings(response.data);
      setSettings(normalized);
      setError(null);
      return normalized;
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
      return null;
    } finally {
      setSavingSettings(false);
    }
  }, []);

  const resetRules = useCallback(async () => {
    setSavingSettings(true);
    try {
      const response = await resetAiEvaluationRules();
      const normalized = normalizeAiSettings(response.data);
      setSettings(normalized);
      setError(null);
      return normalized;
    } catch (caught: unknown) {
      setError(readErrorMessage(caught));
      return null;
    } finally {
      setSavingSettings(false);
    }
  }, []);

  const createEndpoint = useCallback(
    async (input: AiEndpointInput) => {
      setCreatingEndpoint(true);
      try {
        const response = await createAiEndpointRequest(input);
        const endpoint = normalizeAiEndpoint(response.data);
        setEndpoints((items) =>
          replaceEndpoint(
            endpoint.isActive ? items.map((item) => ({ ...item, isActive: false })) : items,
            endpoint,
          ),
        );
        if (endpoint.isActive) {
          await Promise.all([loadSettings(), loadModels({ endpointId: endpoint.id, sync: true })]);
        }
        setEndpointError(null);
        return endpoint;
      } catch (caught: unknown) {
        setEndpointError(readErrorMessage(caught));
        return null;
      } finally {
        setCreatingEndpoint(false);
      }
    },
    [loadModels, loadSettings],
  );

  const updateEndpoint = useCallback(async (id: string, input: AiEndpointUpdateInput) => {
    setMutatingEndpointId(id);
    try {
      const response = await updateAiEndpointRequest(id, input);
      const endpoint = normalizeAiEndpoint(response.data);
      setEndpoints((items) => replaceEndpoint(items, endpoint));
      setEndpointError(null);
      return endpoint;
    } catch (caught: unknown) {
      setEndpointError(readErrorMessage(caught));
      return null;
    } finally {
      setMutatingEndpointId(null);
    }
  }, []);

  const activateEndpoint = useCallback(
    async (id: string) => {
      setMutatingEndpointId(id);
      try {
        const response = await activateAiEndpointRequest(id);
        const endpoint = normalizeAiEndpoint(response.data);
        setEndpoints((items) =>
          replaceEndpoint(
            items.map((item) => ({ ...item, isActive: false })),
            endpoint,
          ),
        );
        await Promise.all([loadSettings(), loadModels({ endpointId: endpoint.id, sync: true })]);
        setEndpointError(null);
        return endpoint;
      } catch (caught: unknown) {
        setEndpointError(readErrorMessage(caught));
        return null;
      } finally {
        setMutatingEndpointId(null);
      }
    },
    [loadModels, loadSettings],
  );

  const removeEndpoint = useCallback(
    async (id: string) => {
      setDeletingEndpointId(id);
      try {
        await deleteAiEndpointRequest(id);
        setEndpoints((items) => items.filter((item) => item.id !== id));
        // Models cascade-delete server-side; mirror that in the local catalog.
        setModels((items) => items.filter((item) => item.endpointId !== id));
        // Deleting the active server clears the active pointer server-side.
        await loadSettings();
        setEndpointError(null);
        return true;
      } catch (caught: unknown) {
        setEndpointError(readErrorMessage(caught));
        return false;
      } finally {
        setDeletingEndpointId(null);
      }
    },
    [loadSettings],
  );

  const removeModel = useCallback(async (id: string) => {
    setDeletingModelId(id);
    try {
      await deleteAiModelRequest(id);
      setModels((items) => items.filter((item) => item.id !== id));
      setModelError(null);
      return true;
    } catch (caught: unknown) {
      setModelError(readErrorMessage(caught));
      return false;
    } finally {
      setDeletingModelId(null);
    }
  }, []);

  const installModel = useCallback(
    async (input: AiModelInstallInput) => {
      setInstallingModel(true);
      try {
        const response = await installAiModelRequest(input);
        const result = normalizeAiModelInstall(response.data);
        setInstallActivity(result.activity);
        setModels((items) => replaceModel(items, result.model));
        await loadActivityPreview(true);
        setModelError(null);
        return result;
      } catch (caught: unknown) {
        setModelError(readErrorMessage(caught));
        return null;
      } finally {
        setInstallingModel(false);
      }
    },
    [loadActivityPreview],
  );

  const refreshInstallActivity = useCallback(async () => {
    if (!installActivity) {
      return;
    }

    try {
      const response = await fetchActivity(installActivity.id);
      const activity = normalizeActivity(response.data);
      setInstallActivity(activity);
      await loadActivityPreview(true);

      if (!isActiveActivity(activity.status)) {
        await loadModels();
      }
    } catch (caught: unknown) {
      setModelError(readErrorMessage(caught));
    }
  }, [installActivity, loadActivityPreview, loadModels]);

  const value = useMemo(
    () => ({
      activateEndpoint,
      checkEndpointHealth,
      createEndpoint,
      creatingEndpoint,
      deletingEndpointId,
      deletingModelId,
      endpointError,
      endpointHealth,
      endpoints,
      error,
      healthCheckingIds,
      installActivity,
      installModel,
      installingModel,
      loadAll,
      loadEndpoints,
      loadModels,
      loadSettings,
      loadingEndpoints,
      loadingModels,
      loadingSettings,
      modelError,
      models,
      mutatingEndpointId,
      refreshInstallActivity,
      removeEndpoint,
      removeModel,
      resetRules,
      saveSettings,
      savingSettings,
      settings,
      updateEndpoint,
    }),
    [
      activateEndpoint,
      checkEndpointHealth,
      createEndpoint,
      creatingEndpoint,
      deletingEndpointId,
      deletingModelId,
      endpointError,
      endpointHealth,
      endpoints,
      error,
      healthCheckingIds,
      installActivity,
      installModel,
      installingModel,
      loadAll,
      loadEndpoints,
      loadModels,
      loadSettings,
      loadingEndpoints,
      loadingModels,
      loadingSettings,
      modelError,
      models,
      mutatingEndpointId,
      refreshInstallActivity,
      removeEndpoint,
      removeModel,
      resetRules,
      saveSettings,
      savingSettings,
      settings,
      updateEndpoint,
    ],
  );

  return <AiSettingsContext.Provider value={value}>{children}</AiSettingsContext.Provider>;
}

export function useAiSettings(): AiSettingsContextValue {
  const value = useContext(AiSettingsContext);
  if (!value) {
    throw new Error('useAiSettings must be used inside AiSettingsProvider');
  }

  return value;
}
