// Network helpers used by every data-source adapter: request timeouts, retries with
// exponential backoff, response validation and a small time-to-live cache that keeps the
// last good answer when an upstream source fails.

export class HttpError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

const USER_AGENT = 'StJohnsRiverWatch/1.0 (local hydrological dashboard)';
const isNode = typeof window === 'undefined';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchWithRetry(url: string, opts: FetchOptions = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: 'application/json, */*', ...(opts.headers ?? {}) };
      // Browsers forbid setting User-Agent; api.weather.gov asks servers to send one.
      if (isNode) headers['User-Agent'] = USER_AGENT;
      const res = await fetch(url, { signal: ctrl.signal, headers });
      clearTimeout(timer);
      if (res.ok) return res;
      // 4xx (except 429) will not get better by retrying
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        throw new HttpError(`HTTP ${res.status} from ${new URL(url).host}`, res.status);
      }
      lastErr = new HttpError(`HTTP ${res.status} from ${new URL(url).host}`, res.status);
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof HttpError && e.status && e.status < 500 && e.status !== 429) throw e;
      lastErr = (e as Error)?.name === 'AbortError' ? new HttpError(`Timed out after ${timeoutMs / 1000}s: ${new URL(url).host}`) : e;
    }
    if (attempt < retries) await sleep(800 * 2 ** attempt + Math.random() * 300);
  }
  throw lastErr instanceof Error ? lastErr : new HttpError(String(lastErr));
}

export async function fetchJson<T = unknown>(url: string, validate?: (j: unknown) => j is T, opts?: FetchOptions): Promise<T> {
  const res = await fetchWithRetry(url, opts);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new HttpError(`Invalid JSON from ${new URL(url).host}`);
  }
  if (validate && !validate(json)) throw new HttpError(`Unexpected response shape from ${new URL(url).host}`);
  return json as T;
}

export async function fetchText(url: string, opts?: FetchOptions): Promise<string> {
  const res = await fetchWithRetry(url, opts);
  return res.text();
}

export const isObj = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null;

/** Time-to-live cache that remembers the last good value and the last error per key. */
export class TtlCache {
  private readonly maxEntries = 2048;
  private store = new Map<string, { value: unknown; at: number }>();
  private inflight = new Map<string, Promise<unknown>>();
  private errors = new Map<string, { message: string; at: number }>();

  async get<T>(key: string, ttlMs: number, loader: () => Promise<T>, opts: { staleOnError?: boolean } = {}): Promise<T> {
    const hit = this.store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;
    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;
    const p = loader()
      .then((v) => {
        this.remember(this.store, key, { value: v, at: Date.now() });
        this.errors.delete(key);
        return v;
      })
      .catch((e: unknown) => {
        this.remember(this.errors, key, { message: (e as Error)?.message ?? String(e), at: Date.now() });
        if (hit && opts.staleOnError !== false) return hit.value as T;
        throw e;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private remember<T>(entries: Map<string, T>, key: string, value: T) {
    entries.delete(key);
    entries.set(key, value);
    if (entries.size > this.maxEntries) entries.delete(entries.keys().next().value!);
  }

  peek<T>(key: string): { value: T; at: number } | undefined {
    return this.store.get(key) as { value: T; at: number } | undefined;
  }

  lastError(key: string) {
    return this.errors.get(key);
  }

  successAt(key: string) {
    return this.store.get(key)?.at;
  }
}

/** Run async tasks with limited concurrency. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx]);
      } catch {
        out[idx] = undefined;
      }
    }
  });
  await Promise.all(workers);
  return out;
}
