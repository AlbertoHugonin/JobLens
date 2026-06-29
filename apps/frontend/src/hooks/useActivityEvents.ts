import { useEffect, useRef, useState } from 'react';

import { createActivityEventSource } from '../API/events';

export type ActivityLiveMode = 'connecting' | 'polling' | 'sse';

const POLLING_INTERVAL_MS = 2_000;

export function useActivityEvents(
  onActivitySnapshot: () => void | Promise<void>,
  enabled = true,
): ActivityLiveMode {
  const [mode, setMode] = useState<ActivityLiveMode>('connecting');
  const callbackRef = useRef(onActivitySnapshot);

  useEffect(() => {
    callbackRef.current = onActivitySnapshot;
  }, [onActivitySnapshot]);

  useEffect(() => {
    if (!enabled) {
      setMode('connecting');
      return undefined;
    }

    let pollingId: number | undefined;
    let closed = false;

    const refresh = () => {
      void callbackRef.current();
    };

    const startPolling = () => {
      if (closed || pollingId !== undefined) {
        return;
      }

      setMode('polling');
      refresh();
      pollingId = window.setInterval(refresh, POLLING_INTERVAL_MS);
    };

    if (typeof EventSource === 'undefined') {
      startPolling();
      return () => {
        closed = true;
        if (pollingId !== undefined) {
          window.clearInterval(pollingId);
        }
      };
    }

    const eventSource = createActivityEventSource();

    eventSource.addEventListener('open', () => {
      if (!closed) {
        setMode('sse');
      }
    });
    eventSource.addEventListener('ready', () => {
      if (!closed) {
        setMode('sse');
      }
    });
    eventSource.addEventListener('activities', () => {
      if (!closed) {
        setMode('sse');
        refresh();
      }
    });
    eventSource.addEventListener('error', () => {
      eventSource?.close();
      startPolling();
    });

    return () => {
      closed = true;
      eventSource?.close();
      if (pollingId !== undefined) {
        window.clearInterval(pollingId);
      }
    };
  }, [enabled]);

  return mode;
}
