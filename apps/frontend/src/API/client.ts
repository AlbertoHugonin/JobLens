export class ApiError extends Error {
  readonly details: unknown;
  readonly status: number;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

type QueryValue = boolean | number | string | null | undefined;
type QueryInput = Record<string, QueryValue | QueryValue[]>;

export interface ApiSuccessDto<TData, TMeta = undefined> {
  data: TData;
  meta?: TMeta;
}

export interface PaginationMetaDto {
  limit: number;
  offset: number;
  total: number;
}

function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, '');
  }

  return import.meta.env.DEV ? 'http://localhost:3000' : '';
}

function appendQuery(searchParams: URLSearchParams, query: QueryInput): void {
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];

    for (const item of values) {
      if (item === undefined || item === null) {
        continue;
      }

      searchParams.append(key, String(item));
    }
  }
}

export function buildApiUrl(path: string, query?: QueryInput): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();

  if (!baseUrl) {
    const searchParams = new URLSearchParams();
    if (query) {
      appendQuery(searchParams, query);
    }
    const queryString = searchParams.toString();
    return queryString ? `${normalizedPath}?${queryString}` : normalizedPath;
  }

  const url = new URL(normalizedPath, `${baseUrl}/`);
  if (query) {
    appendQuery(url.searchParams, query);
  }

  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) {
    return fallback;
  }

  const nestedError = payload.error;
  if (
    isRecord(nestedError) &&
    typeof nestedError.message === 'string' &&
    nestedError.message.trim()
  ) {
    return nestedError.message;
  }

  if (typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message;
  }

  if (typeof payload.error === 'string' && payload.error.trim()) {
    return payload.error;
  }

  const validation = payload.validation;
  if (Array.isArray(validation) && validation.length > 0) {
    return 'Validation error';
  }

  return fallback;
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text || null;
}

export async function apiRequest<TResponse>(
  path: string,
  init: RequestInit = {},
  query?: QueryInput,
): Promise<TResponse> {
  const response = await fetch(buildApiUrl(path, query), {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...init.headers,
    },
  });

  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new ApiError(
      readErrorMessage(payload, `HTTP ${response.status}`),
      response.status,
      payload,
    );
  }

  return payload as TResponse;
}
