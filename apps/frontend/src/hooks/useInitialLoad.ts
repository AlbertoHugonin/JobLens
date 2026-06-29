import { useEffect, useRef } from 'react';

export function useInitialLoad(load: () => void | Promise<void>): void {
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    void loadRef.current();
  }, []);
}
