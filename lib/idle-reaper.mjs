/**
 * Shuts Chromium down when nobody has asked for work for a while, and lets the
 * next request start it again. Chromium with a few TikTok tabs open burns CPU
 * and hundreds of MB of RAM even when no one is signing anything.
 */

export class ActivityTracker {
  /** @param {() => number} [now] */
  constructor(now = Date.now) {
    this.now = now;
    this.active = 0;
    this.lastActivityAt = now();
  }

  /**
   * Mark the start of a unit of work. Call the returned function when it ends.
   * @returns {() => void}
   */
  begin() {
    this.active++;
    this.lastActivityAt = this.now();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.active--;
      this.lastActivityAt = this.now();
    };
  }

  get idleMs() {
    return this.active > 0 ? 0 : this.now() - this.lastActivityAt;
  }
}

/**
 * @param {object} options
 * @param {number} options.idleMs          Idle time before shutdown; <= 0 disables the reaper.
 * @param {ActivityTracker} options.tracker
 * @param {() => boolean} options.isRunning  Is there anything to shut down?
 * @param {() => boolean} options.isBusy     Background work (pool warm-up, queue) in flight?
 * @param {() => Promise<void>} options.shutdown
 * @param {(msg: string) => void} [options.log]
 * @param {number} [options.checkEveryMs]
 * @returns {() => void} stop function
 */
export function startIdleReaper({
  idleMs,
  tracker,
  isRunning,
  isBusy,
  shutdown,
  log = console.log,
  checkEveryMs = Math.min(idleMs, 30_000),
}) {
  if (idleMs <= 0) return () => {};

  let shuttingDown = false;

  const check = async () => {
    if (shuttingDown || !isRunning() || isBusy()) return;
    if (tracker.idleMs < idleMs) return;

    shuttingDown = true;
    log(
      `[Idle] No work for ${Math.round(tracker.idleMs / 1000)}s — closing browser`,
    );
    try {
      await shutdown();
    } catch (e) {
      log(`[Idle] Shutdown failed: ${e.message}`);
    } finally {
      shuttingDown = false;
    }
  };

  const timer = setInterval(check, checkEveryMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
