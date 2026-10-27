/**
 * Chromium command-line flags.
 *
 * BASE_FLAGS are what the server always used. LEAN_FLAGS switch off Chrome's
 * own background services (updater, sync, translate, crash reporter, ...).
 * None of them change what a page can observe — no viewport, UA, GPU or
 * headless-mode changes — so the signing environment stays the same.
 */

export const BASE_FLAGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-blink-features=AutomationControlled",
  "--disable-gpu",
  "--window-size=1920,1080",
];

export const LEAN_FLAGS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-sync",
  "--disable-breakpad",
  "--disable-domain-reliability",
  "--disable-client-side-phishing-detection",
  "--metrics-recording-only",
  "--mute-audio",
  "--disable-features=" +
    [
      "Translate",
      "OptimizationHints",
      "MediaRouter",
      "DialMediaRouteProvider",
      "CertificateTransparencyComponentUpdater",
      "AutofillServerCommunication",
      "InterestFeedContentSuggestions",
    ].join(","),
];

/**
 * @param {{ lean: boolean, proxyHost?: string }} options
 * @returns {string[]}
 */
export function buildChromeArgs({ lean, proxyHost }) {
  const args = [...BASE_FLAGS];
  if (lean) args.push(...LEAN_FLAGS);
  if (proxyHost) args.push(`--proxy-server=http://${proxyHost}`);
  return args;
}
