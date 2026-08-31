import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { cacheCell } from '../shared/geo.js';
import type { PlaceCandidate } from '../shared/types.js';
import { PlaceCache } from './cache.js';
import { RateLimitedQueue } from './queue.js';
import {
  DEFAULT_RADIUS_M,
  overpassQuery,
  parseOverpass,
  parsePhoton,
  photonUrl,
} from './osm.js';

const PORT = Number(process.env.PORT ?? 8787);
/**
 * Overpass instances are volunteer-run and 503 under load often enough that a single
 * endpoint is not a plan. Tried in order; the first that answers wins.
 */
const OVERPASS_URLS = (
  process.env.OVERPASS_URLS ??
  'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter'
)
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);
const CACHE_PATH = process.env.CACHE_PATH ?? new URL('./places.sqlite', import.meta.url).pathname;
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS ?? 30 * 24 * 60 * 60 * 1000);
const MIN_GAP_MS = Number(process.env.MIN_GAP_MS ?? 1100);
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 25_000);

/**
 * Identify ourselves properly. Both Overpass and Photon ask for this, and an
 * anonymous client is the one that gets blocked when someone misbehaves.
 */
const USER_AGENT =
  process.env.OSM_USER_AGENT ??
  'hyperlocal/0.1 (private place notes; https://github.com/jscarrott/experiments)';

const cache = new PlaceCache(CACHE_PATH, CACHE_TTL_MS);
const queue = new RateLimitedQueue(MIN_GAP_MS);

/** Counters, so the /healthz endpoint can show the cache is doing its job. */
const stats = { hits: 0, misses: 0, upstreamErrors: 0 };

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...init?.headers },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

/** Try each Overpass endpoint in turn; throw only when all of them have failed. */
async function fetchOverpass(query: string): Promise<unknown> {
  const failures: string[] = [];
  for (const endpoint of OVERPASS_URLS) {
    try {
      return await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query }).toString(),
      });
    } catch (error) {
      failures.push(`${endpoint}: ${(error as Error).message}`);
    }
  }
  throw new Error(`all Overpass endpoints failed (${failures.join('; ')})`);
}

async function nearby(lat: number, lng: number, radius: number): Promise<PlaceResult> {
  const key = `${cacheCell(lat, lng)}@${radius}`;
  const cached = cache.get<PlaceCandidate[]>('nearby', key);
  if (cached) {
    stats.hits++;
    return { candidates: cached, cached: true };
  }
  stats.misses++;

  try {
    const body = await queue.run(() => fetchOverpass(overpassQuery(lat, lng, radius)));
    const candidates = parseOverpass(body, lat, lng);
    cache.set('nearby', key, candidates);
    return { candidates, cached: false };
  } catch (error) {
    // Never fail the request. A note with a plain pin is a perfectly good note, and
    // Overpass being down must not stop someone writing one.
    stats.upstreamErrors++;
    console.warn(`[places] nearby lookup failed: ${(error as Error).message}`);
    return { candidates: [], cached: false, degraded: true };
  }
}

async function search(q: string, lat?: number, lng?: number): Promise<PlaceResult> {
  const key = `${q.toLowerCase()}@${lat !== undefined ? cacheCell(lat, lng ?? 0, 2) : ''}`;
  const cached = cache.get<PlaceCandidate[]>('search', key);
  if (cached) {
    stats.hits++;
    return { candidates: cached, cached: true };
  }
  stats.misses++;

  try {
    const body = await queue.run(() => fetchJson(photonUrl(q, lat, lng)));
    const candidates = parsePhoton(body);
    cache.set('search', key, candidates);
    return { candidates, cached: false };
  } catch (error) {
    stats.upstreamErrors++;
    console.warn(`[places] search failed: ${(error as Error).message}`);
    return { candidates: [], cached: false, degraded: true };
  }
}

interface PlaceResult {
  candidates: PlaceCandidate[];
  cached: boolean;
  degraded?: boolean;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    // The web client is served from a different origin in dev (Vite on 5173) and
    // possibly in production too, so it needs CORS. Only GETs, nothing credentialed:
    // this proxy holds no user data and never sees a token.
    'access-control-allow-origin': process.env.CORS_ORIGIN ?? '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    // OSM data is ODbL. The client shows this; saying it here too means anyone
    // reading the raw API knows where the data came from.
    'x-data-attribution': 'Data (c) OpenStreetMap contributors, ODbL',
  });
  res.end(payload);
}

function numberParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return send(res, 405, { error: 'MethodNotAllowed' });

  if (url.pathname === '/healthz') {
    return send(res, 200, { ok: true, ...stats });
  }

  if (url.pathname === '/places/nearby') {
    const lat = numberParam(url.searchParams, 'lat');
    const lng = numberParam(url.searchParams, 'lng');
    if (lat === undefined || lng === undefined || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return send(res, 400, { error: 'InvalidRequest', message: 'lat and lng required' });
    }
    const radius = Math.min(numberParam(url.searchParams, 'radius') ?? DEFAULT_RADIUS_M, 500);
    return send(res, 200, await nearby(lat, lng, radius));
  }

  if (url.pathname === '/places/search') {
    const q = url.searchParams.get('q')?.trim();
    if (!q) return send(res, 400, { error: 'InvalidRequest', message: 'q required' });
    return send(res, 200, await search(q, numberParam(url.searchParams, 'lat'), numberParam(url.searchParams, 'lng')));
  }

  send(res, 404, { error: 'NotFound' });
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('[places] unhandled', error);
    if (!res.headersSent) send(res, 500, { error: 'InternalError' });
  });
});

server.listen(PORT, () => {
  console.log(`[places] listening on http://127.0.0.1:${PORT}`);
  console.log(`[places] cache ${CACHE_PATH}`);
  console.log(`[places] overpass ${OVERPASS_URLS.join(', ')}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    cache.close();
    process.exit(0);
  });
}
