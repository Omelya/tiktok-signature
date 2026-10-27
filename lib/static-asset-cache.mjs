/**
 * Shared in-memory cache for TikTok's static JS/CSS.
 *
 * Every identity lives in its own incognito context, so Chromium's HTTP cache
 * is never shared: each new identity downloads TikTok's multi-MB web bundle
 * again — through the (often per-GB billed) proxy — and on every reload. The
 * bundle files are content-hashed CDN assets, so the first identity's copy is
 * replayed to later ones through request interception.
 */

const CACHEABLE_TYPES = new Set(["script", "stylesheet"]);

/** Response headers worth replaying. CORS ones matter: TikTok loads its
 * bundle with `crossorigin`, and a replay without them is blocked. */
const REPLAYED_HEADERS = [
  "content-type",
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "timing-allow-origin",
  "cache-control",
  "vary",
];

/**
 * @typedef {{ status: number, headers: Record<string, string>, body: Buffer }} CachedAsset
 */

export class StaticAssetCache {
  /**
   * @param {object} options
   * @param {number} options.maxBytes
   * @param {RegExp} options.hostPattern
   */
  constructor({ maxBytes, hostPattern }) {
    this.maxBytes = maxBytes;
    this.hostPattern = hostPattern;
    /** @type {Map<string, CachedAsset>} insertion order = LRU order */
    this.entries = new Map();
    this.bytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  get enabled() {
    return this.maxBytes > 0;
  }

  /**
   * Is this request a candidate for the cache at all?
   * @param {string} url
   * @param {string} method
   * @param {string} resourceType
   */
  isCacheable(url, method, resourceType) {
    if (!this.enabled || method !== "GET") return false;
    if (!CACHEABLE_TYPES.has(resourceType)) return false;
    try {
      return this.hostPattern.test(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  /** @param {string} url @returns {CachedAsset | undefined} */
  get(url) {
    const entry = this.entries.get(url);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    // Refresh LRU position.
    this.entries.delete(url);
    this.entries.set(url, entry);
    this.hits++;
    return entry;
  }

  has(url) {
    return this.entries.has(url);
  }

  /** @param {string} url @param {CachedAsset} asset */
  set(url, asset) {
    const size = asset.body.length;
    if (size === 0 || size > this.maxBytes) return;

    if (this.entries.has(url)) this.delete(url);
    this.entries.set(url, asset);
    this.bytes += size;

    for (const oldestUrl of this.entries.keys()) {
      if (this.bytes <= this.maxBytes) break;
      this.delete(oldestUrl);
    }
  }

  delete(url) {
    const entry = this.entries.get(url);
    if (!entry) return;
    this.bytes -= entry.body.length;
    this.entries.delete(url);
  }

  stats() {
    return {
      enabled: this.enabled,
      entries: this.entries.size,
      sizeMB: +(this.bytes / 1024 / 1024).toFixed(1),
      maxMB: Math.round(this.maxBytes / 1024 / 1024),
      hits: this.hits,
      misses: this.misses,
    };
  }
}

/** @param {Record<string, string>} headers */
export function pickReplayedHeaders(headers) {
  const picked = {};
  for (const name of REPLAYED_HEADERS) {
    if (headers[name] !== undefined) picked[name] = headers[name];
  }
  return picked;
}

/**
 * Answer an intercepted request from the cache.
 * @param {import("puppeteer").HTTPRequest} request
 * @param {StaticAssetCache} cache
 * @returns {Promise<boolean>} true if the request was answered
 */
export async function respondFromCache(request, cache) {
  if (
    !cache.isCacheable(request.url(), request.method(), request.resourceType())
  )
    return false;

  const asset = cache.get(request.url());
  if (!asset) return false;

  await request.respond({
    status: asset.status,
    headers: asset.headers,
    body: asset.body,
  });
  return true;
}

/**
 * Store a network response in the cache if it qualifies.
 * @param {import("puppeteer").HTTPResponse} response
 * @param {StaticAssetCache} cache
 */
export async function rememberResponse(response, cache) {
  const request = response.request();
  const url = request.url();
  if (!cache.isCacheable(url, request.method(), request.resourceType())) return;
  if (response.status() !== 200 || cache.has(url)) return;

  try {
    const body = await response.buffer();
    cache.set(url, {
      status: 200,
      headers: pickReplayedHeaders(response.headers()),
      body,
    });
  } catch {
    // Body unavailable (redirect, page closed mid-load) — just skip it.
  }
}
