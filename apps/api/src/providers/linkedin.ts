import { ProviderError } from './types.js';
import type {
  CredentialField,
  ProviderPlugin,
  ProviderSessionEnvelope,
  ProviderSessionVerification,
} from './types.js';

export const LINKEDIN_PROVIDER_KEY = 'linkedin';
export const LINKEDIN_PROVIDER_NAME = 'LinkedIn';
export const LINKEDIN_PUBLIC_SEARCH_URL = 'https://www.linkedin.com/jobs/search/';
export const LINKEDIN_JOB_CARDS_PATH = '/voyager/api/voyagerJobsDashJobCards';
const LINKEDIN_PUBLIC_SEARCH_PATH = '/jobs/search/';
const LINKEDIN_VERIFY_URL = 'https://www.linkedin.com/voyager/api/me';
const LINKEDIN_VOYAGER_ACCEPT = 'application/vnd.linkedin.normalized+json+2.1';
const LINKEDIN_DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const SESSION_ENVELOPE_VERSION = 2;

/**
 * The only two values that are strictly required for reliable Voyager access,
 * verified empirically against the live API:
 *  - `li_at`     -> authentication cookie
 *  - `JSESSIONID` (format `ajax:<digits>`) -> used both as a cookie and, with
 *    the surrounding quotes stripped, as the `csrf-token` header.
 * Everything else (other cookies, user-agent, tracking headers) is optional.
 */
export const LINKEDIN_CREDENTIAL_FIELDS: CredentialField[] = [
  {
    help: 'Cookie di autenticazione LinkedIn. DevTools > Application > Cookies > www.linkedin.com > li_at.',
    label: 'li_at',
    name: 'li_at',
    placeholder: 'AQED...',
    required: true,
    secret: true,
  },
  {
    help: 'Valore del cookie JSESSIONID (formato ajax:1234...). Serve anche come token CSRF.',
    label: 'JSESSIONID',
    name: 'jsessionid',
    placeholder: 'ajax:1234567890',
    required: true,
    secret: true,
  },
  {
    help: 'Opzionale: User-Agent del browser usato. Migliora la somiglianza con una sessione reale.',
    label: 'User-Agent',
    name: 'userAgent',
    required: false,
    secret: false,
  },
];

export const linkedinDistanceValues = ['0', '5', '10', '25', '50'] as const;
export type LinkedInDistance = (typeof linkedinDistanceValues)[number];

export const linkedinExperienceLevelValues = ['1', '2', '3', '4', '5', '6'] as const;
export type LinkedInExperienceLevel = (typeof linkedinExperienceLevelValues)[number];

export const linkedinWorkplaceTypeValues = ['1', '2', '3'] as const;
export type LinkedInWorkplaceType = (typeof linkedinWorkplaceTypeValues)[number];

export interface LinkedInSearchQuery {
  currentJobId: string | null;
  distance: LinkedInDistance;
  exactMatch: boolean;
  experienceLevels: LinkedInExperienceLevel[];
  geoId: string;
  keywords: string;
  location: string;
  preservedParams: Record<string, string>;
  providerKey: typeof LINKEDIN_PROVIDER_KEY;
  publicUrl: string;
  unsupportedParams: Record<string, string>;
  workplaceTypes: LinkedInWorkplaceType[];
}

export interface LinkedInHarRequestDebug {
  count: string | null;
  decorationId: string | null;
  hasCookie: boolean;
  hasCsrfToken: boolean;
  hasQuery: boolean;
  host: string;
  method: string;
  path: string;
  q: string | null;
  queryParamNames: string[];
  recognizedFilters: string[];
  start: string | null;
}

export interface LinkedInHarDebug {
  jobCardRequestCount: number;
  requests: LinkedInHarRequestDebug[];
  selectedRequest: LinkedInHarRequestDebug | null;
}

type LinkedInSessionSource = 'har' | 'har_public_search';

export interface LinkedInSessionSummary {
  acceptLanguage: string | null;
  decorationId: string | null;
  hasJsessionid: boolean;
  hasLiAt: boolean;
  hasXLiTrack: boolean;
  importedAt: string | null;
  jobCardRequestCount: number;
  source: string | null;
  userAgent: string | null;
  xLiLang: string | null;
}

export interface LinkedInGeoHit {
  displayName: string;
  geoId: string;
  type: string | null;
}

export class LinkedInProviderError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'LinkedInProviderError';
  }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

function readString(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readBoolean(record: JsonRecord, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function requireString(record: JsonRecord, key: string): string {
  const value = readString(record, key);
  if (!value) {
    throw new LinkedInProviderError(`${key} is required`);
  }

  return value;
}

function normalizeDistance(value: unknown): LinkedInDistance {
  if (typeof value === 'string' && linkedinDistanceValues.includes(value as LinkedInDistance)) {
    return value as LinkedInDistance;
  }

  if (typeof value === 'number') {
    const text = String(value);
    if (linkedinDistanceValues.includes(text as LinkedInDistance)) {
      return text as LinkedInDistance;
    }
  }

  return '25';
}

function normalizeExperienceLevels(value: unknown): LinkedInExperienceLevel[] {
  const input = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const normalized = input
    .map((item) => String(item).trim())
    .filter((item): item is LinkedInExperienceLevel =>
      linkedinExperienceLevelValues.includes(item as LinkedInExperienceLevel),
    );

  return Array.from(new Set(normalized));
}

function normalizeWorkplaceTypes(value: unknown): LinkedInWorkplaceType[] {
  const input = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const normalized = input
    .map((item) => String(item).trim())
    .filter((item): item is LinkedInWorkplaceType =>
      linkedinWorkplaceTypeValues.includes(item as LinkedInWorkplaceType),
    );

  return Array.from(new Set(normalized));
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      output[key] = item;
    }
  }

  return output;
}

export function buildLinkedInSearchUrl(query: Omit<LinkedInSearchQuery, 'publicUrl'>): string {
  const url = new URL(LINKEDIN_PUBLIC_SEARCH_URL);
  const keywords = query.exactMatch ? `"${query.keywords}"` : query.keywords;

  url.searchParams.set('keywords', keywords);
  url.searchParams.set('location', query.location);
  url.searchParams.set('geoId', query.geoId);
  url.searchParams.set('distance', query.distance);

  if (query.experienceLevels.length > 0) {
    url.searchParams.set('f_E', query.experienceLevels.join(','));
  }

  if (query.workplaceTypes.length > 0) {
    url.searchParams.set('f_WT', query.workplaceTypes.join(','));
  }

  if (query.currentJobId) {
    url.searchParams.set('currentJobId', query.currentJobId);
  }

  for (const [key, value] of Object.entries(query.preservedParams)) {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value);
    }
  }

  url.searchParams.set('position', '1');
  url.searchParams.set('pageNum', '0');

  return url.toString().replaceAll('%2C', ',');
}

export function normalizeLinkedInSearchInput(input: unknown): LinkedInSearchQuery {
  if (!isRecord(input)) {
    throw new LinkedInProviderError('query must be an object');
  }

  const keywords = requireString(input, 'keywords');
  const location = requireString(input, 'location');
  const geoId = requireString(input, 'geoId');
  const exactMatch = readBoolean(input, 'exactMatch') ?? false;
  const distance = normalizeDistance(input.distance);
  const experienceLevels = normalizeExperienceLevels(input.experienceLevels);
  const workplaceTypes = normalizeWorkplaceTypes(input.workplaceTypes);
  const currentJobId = readString(input, 'currentJobId');
  const preservedParams = readStringRecord(input.preservedParams);
  const unsupportedParams = readStringRecord(input.unsupportedParams);
  const query: Omit<LinkedInSearchQuery, 'publicUrl'> = {
    currentJobId,
    distance,
    exactMatch,
    experienceLevels,
    geoId,
    keywords,
    location,
    preservedParams,
    providerKey: LINKEDIN_PROVIDER_KEY,
    unsupportedParams,
    workplaceTypes,
  };

  return {
    ...query,
    publicUrl: buildLinkedInSearchUrl(query),
  };
}

export function parseLinkedInSearchUrl(input: string): LinkedInSearchQuery {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new LinkedInProviderError('URL is not valid');
  }

  if (!url.hostname.endsWith('linkedin.com') || !url.pathname.startsWith('/jobs/search')) {
    throw new LinkedInProviderError('URL is not a LinkedIn jobs search URL');
  }

  const keywordsParam = url.searchParams.get('keywords')?.trim() ?? '';
  const exactMatch = keywordsParam.startsWith('"') && keywordsParam.endsWith('"');
  const keywords = exactMatch ? keywordsParam.slice(1, -1).trim() : keywordsParam;
  const knownParams = new Set([
    'currentJobId',
    'distance',
    'f_E',
    'f_WT',
    'geoId',
    'keywords',
    'location',
    'pageNum',
    'position',
  ]);
  const preservedParamNames = new Set(['f_JT', 'f_TPR']);
  const preservedParams: Record<string, string> = {};
  const unsupportedParams: Record<string, string> = {};

  for (const [key, value] of url.searchParams.entries()) {
    if (knownParams.has(key)) {
      continue;
    }

    if (preservedParamNames.has(key)) {
      preservedParams[key] = value;
      continue;
    }

    unsupportedParams[key] = value;
  }

  const query = normalizeLinkedInSearchInput({
    currentJobId: url.searchParams.get('currentJobId'),
    distance: url.searchParams.get('distance') ?? undefined,
    exactMatch,
    experienceLevels: url.searchParams.get('f_E') ?? undefined,
    geoId: url.searchParams.get('geoId') ?? undefined,
    keywords,
    location: url.searchParams.get('location') ?? undefined,
    preservedParams,
    unsupportedParams,
    workplaceTypes: url.searchParams.get('f_WT') ?? undefined,
  });

  return query;
}

function readHarEntries(input: unknown): JsonRecord[] {
  const har = typeof input === 'string' ? parseJson(input) : input;

  if (!isRecord(har) || !isRecord(har.log) || !Array.isArray(har.log.entries)) {
    throw new LinkedInProviderError('HAR must contain log.entries');
  }

  return har.log.entries.filter(isRecord);
}

function parseJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    throw new LinkedInProviderError('HAR JSON is not valid');
  }
}

function readHeaders(request: JsonRecord): Map<string, string> {
  const headers = new Map<string, string>();
  const rawHeaders = Array.isArray(request.headers) ? request.headers : [];

  for (const item of rawHeaders) {
    if (!isRecord(item)) {
      continue;
    }

    const name = readString(item, 'name')?.toLowerCase();
    const value = readString(item, 'value');

    if (name && value) {
      headers.set(name, value);
    }
  }

  return headers;
}

function readUrl(request: JsonRecord): URL | null {
  const rawUrl = readString(request, 'url');
  if (!rawUrl) {
    return null;
  }

  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function readQueryParamNames(request: JsonRecord, url: URL): string[] {
  const names = new Set<string>();
  for (const key of url.searchParams.keys()) {
    names.add(key);
  }

  const queryString = Array.isArray(request.queryString) ? request.queryString : [];
  for (const item of queryString) {
    if (!isRecord(item)) {
      continue;
    }

    const name = readString(item, 'name');
    if (name) {
      names.add(name);
    }
  }

  return Array.from(names).sort();
}

function extractCookieValue(cookieHeader: string, key: string): string | null {
  const cookies = cookieHeader.split(';');

  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.split('=');
    const name = rawName?.trim();
    const value = rawValue.join('=').trim();

    if (name === key && value) {
      return value.replace(/^"|"$/g, '');
    }
  }

  return null;
}

function extractRecognizedFilters(queryValue: string | null): string[] {
  if (!queryValue) {
    return [];
  }

  const filters: Array<[string, string]> = [
    ['distance', 'distance:List('],
    ['experience', 'experience:List('],
    ['jobType', 'jobType:List('],
    ['timePostedRange', 'timePostedRange:List('],
    ['workplaceType', 'workplaceType:List('],
  ];

  return filters.filter(([, marker]) => queryValue.includes(marker)).map(([name]) => name);
}

function buildHarRequestDebug(request: JsonRecord, url: URL, headers: Map<string, string>) {
  const queryValue = url.searchParams.get('query');

  return {
    count: url.searchParams.get('count'),
    decorationId: url.searchParams.get('decorationId'),
    hasCookie: headers.has('cookie'),
    hasCsrfToken:
      headers.has('csrf-token') || Boolean(headers.get('cookie')?.includes('JSESSIONID=')),
    hasQuery: Boolean(queryValue),
    host: url.hostname,
    method: readString(request, 'method') ?? 'GET',
    path: url.pathname,
    q: url.searchParams.get('q'),
    queryParamNames: readQueryParamNames(request, url),
    recognizedFilters: extractRecognizedFilters(queryValue),
    start: url.searchParams.get('start'),
  } satisfies LinkedInHarRequestDebug;
}

function isLinkedInHost(url: URL): boolean {
  return url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com');
}

function isLinkedInJobCardsRequest(url: URL): boolean {
  return isLinkedInHost(url) && url.pathname === LINKEDIN_JOB_CARDS_PATH;
}

function isLinkedInPublicSearchRequest(url: URL): boolean {
  return isLinkedInHost(url) && url.pathname === LINKEDIN_PUBLIC_SEARCH_PATH;
}

function readSessionCandidateRequests(input: unknown): Array<{
  headers: Map<string, string>;
  source: LinkedInSessionSource;
  url: URL;
}> {
  const fallbackRequests: Array<{
    headers: Map<string, string>;
    source: LinkedInSessionSource;
    url: URL;
  }> = [];

  for (const entry of readHarEntries(input)) {
    const request = isRecord(entry.request) ? entry.request : null;
    const url = request ? readUrl(request) : null;

    if (!request || !url) {
      continue;
    }

    if (isLinkedInJobCardsRequest(url)) {
      return [
        {
          headers: readHeaders(request),
          source: 'har',
          url,
        },
      ];
    }

    if (isLinkedInPublicSearchRequest(url)) {
      fallbackRequests.push({
        headers: readHeaders(request),
        source: 'har_public_search',
        url,
      });
    }
  }

  return fallbackRequests;
}

export function debugLinkedInHar(input: unknown): LinkedInHarDebug {
  const entries = readHarEntries(input);
  const requests = entries
    .map((entry) => (isRecord(entry.request) ? entry.request : null))
    .filter((request): request is JsonRecord => Boolean(request))
    .map((request) => {
      const url = readUrl(request);

      if (
        !url ||
        !url.hostname.endsWith('linkedin.com') ||
        url.pathname !== LINKEDIN_JOB_CARDS_PATH
      ) {
        return null;
      }

      return buildHarRequestDebug(request, url, readHeaders(request));
    })
    .filter((debug): debug is LinkedInHarRequestDebug => Boolean(debug));

  return {
    jobCardRequestCount: requests.length,
    requests,
    selectedRequest: requests[0] ?? null,
  };
}

function stripQuotes(value: string): string {
  return value.replace(/^"|"$/g, '');
}

function buildFingerprintFromHeaders(
  headers: Map<string, string>,
  url: URL,
  source: LinkedInSessionSource,
): Record<string, string> {
  const fingerprint: Record<string, string> = {};
  const userAgent = headers.get('user-agent');
  const acceptLanguage = headers.get('accept-language');
  const xLiLang = headers.get('x-li-lang');
  const xLiTrack = headers.get('x-li-track');
  const decorationId = source === 'har' ? url.searchParams.get('decorationId') : null;

  if (userAgent) {
    fingerprint.userAgent = userAgent;
  }
  if (acceptLanguage) {
    fingerprint.acceptLanguage = acceptLanguage;
  }
  if (xLiLang) {
    fingerprint.xLiLang = xLiLang;
  }
  if (xLiTrack) {
    fingerprint.xLiTrack = xLiTrack;
  }
  if (decorationId) {
    fingerprint.decorationId = decorationId;
  }

  return fingerprint;
}

/** Reduce a full HAR to the minimal credential envelope. */
export function buildLinkedInSessionFromHar(input: unknown): ProviderSessionEnvelope {
  for (const candidate of readSessionCandidateRequests(input)) {
    const { headers, source, url } = candidate;
    const cookie = headers.get('cookie');

    if (!cookie) {
      throw new LinkedInProviderError('LinkedIn session request does not contain a cookie header');
    }

    const liAt = extractCookieValue(cookie, 'li_at');
    const rawJsession = headers.get('csrf-token') ?? extractCookieValue(cookie, 'JSESSIONID');
    const jsessionid = rawJsession ? stripQuotes(rawJsession) : null;

    if (!liAt) {
      throw new LinkedInProviderError('HAR cookie does not contain a li_at value');
    }

    if (!jsessionid) {
      throw new LinkedInProviderError('HAR does not contain a JSESSIONID / CSRF token');
    }

    return {
      debug: debugLinkedInHar(input),
      fingerprint: buildFingerprintFromHeaders(headers, url, source),
      importedAt: new Date().toISOString(),
      providerKey: LINKEDIN_PROVIDER_KEY,
      secrets: { jsessionid, li_at: liAt },
      source: 'har',
      version: SESSION_ENVELOPE_VERSION,
    };
  }

  throw new LinkedInProviderError(
    'HAR does not contain a LinkedIn job cards or public jobs search request',
  );
}

/** Build the envelope from manually entered credentials. */
export function buildLinkedInSessionFromCredentials(
  input: Record<string, unknown>,
): ProviderSessionEnvelope {
  const record = isRecord(input) ? input : {};
  const liAt = readString(record, 'li_at');
  const rawJsession = readString(record, 'jsessionid');

  if (!liAt) {
    throw new LinkedInProviderError('li_at is required');
  }

  if (!rawJsession) {
    throw new LinkedInProviderError('JSESSIONID is required');
  }

  const fingerprint: Record<string, string> = {};
  const userAgent = readString(record, 'userAgent');
  const acceptLanguage = readString(record, 'acceptLanguage');
  const xLiLang = readString(record, 'xLiLang');

  if (userAgent) {
    fingerprint.userAgent = userAgent;
  }
  if (acceptLanguage) {
    fingerprint.acceptLanguage = acceptLanguage;
  }
  if (xLiLang) {
    fingerprint.xLiLang = xLiLang;
  }

  return {
    fingerprint,
    importedAt: new Date().toISOString(),
    providerKey: LINKEDIN_PROVIDER_KEY,
    secrets: { jsessionid: stripQuotes(rawJsession), li_at: liAt },
    source: 'manual',
    version: SESSION_ENVELOPE_VERSION,
  };
}

/** Resolve li_at + JSESSIONID from a persisted envelope (with legacy fallback). */
function readLinkedInSecrets(input: unknown): { jsessionid: string; liAt: string } | null {
  const data = isRecord(input) ? input : {};
  const secrets = isRecord(data.secrets) ? data.secrets : {};
  let liAt = readString(secrets, 'li_at');
  let jsession = readString(secrets, 'jsessionid') ?? readString(data, 'csrfToken');

  if ((!liAt || !jsession) && typeof data.cookie === 'string') {
    liAt = liAt ?? extractCookieValue(data.cookie, 'li_at');
    jsession = jsession ?? extractCookieValue(data.cookie, 'JSESSIONID');
  }

  if (!liAt || !jsession) {
    return null;
  }

  return { jsessionid: stripQuotes(jsession), liAt };
}

export function summarizeLinkedInSession(input: unknown): LinkedInSessionSummary {
  const data = isRecord(input) ? input : {};
  const fingerprint = isRecord(data.fingerprint) ? data.fingerprint : {};
  const resolved = readLinkedInSecrets(input);

  return {
    acceptLanguage: readString(fingerprint, 'acceptLanguage') ?? readString(data, 'acceptLanguage'),
    decorationId: readString(fingerprint, 'decorationId') ?? readString(data, 'decorationId'),
    hasJsessionid: Boolean(resolved?.jsessionid),
    hasLiAt: Boolean(resolved?.liAt),
    hasXLiTrack: Boolean(readString(fingerprint, 'xLiTrack') ?? readString(data, 'xLiTrack')),
    importedAt: readString(data, 'importedAt'),
    jobCardRequestCount:
      isRecord(data.debug) && typeof data.debug.jobCardRequestCount === 'number'
        ? data.debug.jobCardRequestCount
        : 0,
    source: readString(data, 'source'),
    userAgent: readString(fingerprint, 'userAgent') ?? readString(data, 'userAgent'),
    xLiLang: readString(fingerprint, 'xLiLang') ?? readString(data, 'xLiLang'),
  };
}

/** Reconstruct the `cookie` header from the two minimal secrets. */
export function buildLinkedInCookieHeader(liAt: string, jsessionid: string): string {
  return `li_at=${liAt}; JSESSIONID="${jsessionid}"`;
}

export async function verifyLinkedInSession(input: unknown): Promise<ProviderSessionVerification> {
  const secrets = readLinkedInSecrets(input);
  if (!secrets) {
    return { alive: false, message: 'Session is missing li_at or JSESSIONID', status: null };
  }

  const data = isRecord(input) ? input : {};
  const fingerprint = isRecord(data.fingerprint) ? data.fingerprint : {};
  const userAgent = readString(fingerprint, 'userAgent') ?? LINKEDIN_DEFAULT_USER_AGENT;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch(LINKEDIN_VERIFY_URL, {
      headers: {
        accept: LINKEDIN_VOYAGER_ACCEPT,
        cookie: buildLinkedInCookieHeader(secrets.liAt, secrets.jsessionid),
        'csrf-token': secrets.jsessionid,
        'user-agent': userAgent,
        'x-restli-protocol-version': '2.0.0',
      },
      signal: controller.signal,
    });
    const alive = response.status === 200;

    return {
      alive,
      message: alive ? null : `LinkedIn returned HTTP ${response.status}`,
      status: response.status,
    };
  } catch (error) {
    return {
      alive: false,
      message: error instanceof Error ? error.message : 'verification request failed',
      status: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readCandidateGeoId(record: JsonRecord): string | null {
  const direct = readString(record, 'geoId') ?? readString(record, 'id');
  if (direct) {
    return direct.replace(/^urn:li:geo:/, '');
  }

  const urn =
    readString(record, 'entityUrn') ??
    readString(record, 'targetUrn') ??
    readString(record, 'trackingUrn') ??
    readString(record, 'geoUrn');

  return urn?.match(/geo:(\d+)/)?.[1] ?? null;
}

function readCandidateDisplayName(record: JsonRecord): string | null {
  const direct =
    readString(record, 'displayName') ??
    readString(record, 'displayText') ??
    readString(record, 'name') ??
    readString(record, 'title');

  if (direct) {
    return direct;
  }

  const text = record.text;
  if (isRecord(text)) {
    return readString(text, 'text') ?? readString(text, 'value');
  }

  return null;
}

function collectGeoCandidates(value: unknown, output: LinkedInGeoHit[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectGeoCandidates(item, output);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const geoId = readCandidateGeoId(value);
  const displayName = readCandidateDisplayName(value);

  if (geoId && displayName) {
    output.push({
      displayName,
      geoId,
      type: readString(value, 'type') ?? readString(value, 'geoType'),
    });
  }

  for (const item of Object.values(value)) {
    if (isRecord(item) || Array.isArray(item)) {
      collectGeoCandidates(item, output);
    }
  }
}

export function normalizeLinkedInGeoTypeaheadPayload(payload: unknown): LinkedInGeoHit[] {
  const candidates: LinkedInGeoHit[] = [];
  collectGeoCandidates(payload, candidates);

  const byGeoId = new Map<string, LinkedInGeoHit>();
  for (const candidate of candidates) {
    if (!byGeoId.has(candidate.geoId)) {
      byGeoId.set(candidate.geoId, candidate);
    }
  }

  return Array.from(byGeoId.values());
}

export const linkedInProvider: ProviderPlugin = {
  buildSessionFromCredentials: buildLinkedInSessionFromCredentials,
  buildSessionFromHar: buildLinkedInSessionFromHar,
  credentialFields: LINKEDIN_CREDENTIAL_FIELDS,
  debugHar: debugLinkedInHar,
  key: LINKEDIN_PROVIDER_KEY,
  name: LINKEDIN_PROVIDER_NAME,
  summarizeSession: summarizeLinkedInSession,
  verifySession: verifyLinkedInSession,
};
