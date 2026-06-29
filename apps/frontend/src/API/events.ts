import { buildApiUrl } from './client';

export function createActivityEventSource(): EventSource {
  return new EventSource(buildApiUrl('/api/v1/events'), {
    withCredentials: true,
  });
}
