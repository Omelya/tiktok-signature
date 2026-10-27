/**
 * Environment parsing helpers and the low-resource tuning options.
 *
 * Every option has a default that favours low CPU / RAM / traffic; set the
 * env var to opt out.
 */

/**
 * @param {string} name
 * @param {number} fallback
 * @returns {number}
 */
export function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * @param {string} name
 * @param {boolean} fallback
 * @returns {boolean}
 */
export function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

/**
 * Comma-separated list, trimmed, empty items dropped.
 * @param {string} name
 * @param {string[]} fallback
 * @returns {string[]}
 */
export function envList(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const MB = 1024 * 1024;

/** Close Chromium after this long without /signature, /fetch or /restart. 0 = never. */
export const IDLE_SHUTDOWN_MS = envInt("IDLE_SHUTDOWN_MS", 10 * 60 * 1000);

/** Mint the identity pool at startup instead of on the first request. */
export const WARM_ON_START = envBool("WARM_ON_START", true);

/** In-memory cache for TikTok's static JS/CSS, shared by all identities. 0 = off. */
export const STATIC_CACHE_MAX_BYTES = envInt("STATIC_CACHE_MAX_MB", 64) * MB;

/** Hostnames whose scripts/styles may be cached (content-hashed CDN assets). */
export const STATIC_CACHE_HOST_PATTERN = new RegExp(
  process.env.STATIC_CACHE_HOST_PATTERN ||
    "(^|\\.)(ttwstatic\\.com|tiktokcdn(-[a-z]+)?\\.com|ibytedtos\\.com|byteoversea\\.com)$",
  "i",
);

/** Request types aborted while an identity is being primed. */
export const BLOCKED_RESOURCE_TYPES = new Set(
  envList("BLOCKED_RESOURCE_TYPES", ["image", "media", "font"]),
);

/** Add Chromium flags that switch off background services. */
export const LEAN_CHROME_FLAGS = envBool("LEAN_CHROME_FLAGS", true);
