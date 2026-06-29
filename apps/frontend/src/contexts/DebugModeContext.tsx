import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'joblens.debugMode';

interface DebugModeValue {
  debugMode: boolean;
  setDebugMode: (enabled: boolean) => void;
}

const DebugModeContext = createContext<DebugModeValue | undefined>(undefined);

function readInitial(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(STORAGE_KEY) === 'true';
}

export function DebugModeProvider({ children }: { children: ReactNode }) {
  const [debugMode, setDebugModeState] = useState<boolean>(readInitial);

  const setDebugMode = useCallback((enabled: boolean) => {
    setDebugModeState(enabled);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, String(enabled));
    }
  }, []);

  const value = useMemo<DebugModeValue>(
    () => ({ debugMode, setDebugMode }),
    [debugMode, setDebugMode],
  );

  return <DebugModeContext.Provider value={value}>{children}</DebugModeContext.Provider>;
}

export function useDebugMode(): DebugModeValue {
  const context = useContext(DebugModeContext);
  if (!context) {
    throw new Error('useDebugMode must be used inside DebugModeProvider');
  }

  return context;
}
