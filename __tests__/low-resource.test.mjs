/**
 * Unit tests for the low-resource helpers (no browser needed).
 */

import { jest } from "@jest/globals";
import { envBool, envInt, envList } from "../lib/config.mjs";
import {
  BASE_FLAGS,
  LEAN_FLAGS,
  buildChromeArgs,
} from "../lib/chrome-flags.mjs";
import { ActivityTracker, startIdleReaper } from "../lib/idle-reaper.mjs";
import {
  StaticAssetCache,
  pickReplayedHeaders,
  rememberResponse,
  respondFromCache,
} from "../lib/static-asset-cache.mjs";

const CDN_SCRIPT =
  "https://sf16-website-login.neutral.ttwstatic.com/obj/app.js";
const HOST_PATTERN = /(^|\.)ttwstatic\.com$/i;

function asset(size) {
  return { status: 200, headers: {}, body: Buffer.alloc(size, 1) };
}

describe("config helpers", () => {
  afterEach(() => {
    delete process.env.TEST_VALUE;
  });

  test("envInt falls back on missing, empty and invalid values", () => {
    expect(envInt("TEST_VALUE", 5)).toBe(5);
    process.env.TEST_VALUE = "";
    expect(envInt("TEST_VALUE", 5)).toBe(5);
    process.env.TEST_VALUE = "abc";
    expect(envInt("TEST_VALUE", 5)).toBe(5);
    process.env.TEST_VALUE = "0";
    expect(envInt("TEST_VALUE", 5)).toBe(0);
  });

  test("envBool understands common spellings", () => {
    expect(envBool("TEST_VALUE", true)).toBe(true);
    process.env.TEST_VALUE = "false";
    expect(envBool("TEST_VALUE", true)).toBe(false);
    process.env.TEST_VALUE = "ON";
    expect(envBool("TEST_VALUE", false)).toBe(true);
  });

  test("envList trims and drops empty items", () => {
    process.env.TEST_VALUE = " image, ,font ";
    expect(envList("TEST_VALUE", [])).toEqual(["image", "font"]);
  });
});

describe("buildChromeArgs", () => {
  test("adds lean flags and proxy only when asked", () => {
    expect(buildChromeArgs({ lean: false })).toEqual(BASE_FLAGS);

    const args = buildChromeArgs({ lean: true, proxyHost: "p.example:8080" });
    expect(args).toEqual(expect.arrayContaining(LEAN_FLAGS));
    expect(args).toContain("--proxy-server=http://p.example:8080");
  });

  test("never touches fingerprint-relevant flags", () => {
    for (const flag of LEAN_FLAGS) {
      expect(flag).not.toMatch(/user-agent|window-size|headless|use-gl|lang/);
    }
  });
});

describe("StaticAssetCache", () => {
  test("only CDN scripts/styles fetched with GET are cacheable", () => {
    const cache = new StaticAssetCache({
      maxBytes: 100,
      hostPattern: HOST_PATTERN,
    });
    expect(cache.isCacheable(CDN_SCRIPT, "GET", "script")).toBe(true);
    expect(cache.isCacheable(CDN_SCRIPT, "GET", "stylesheet")).toBe(true);
    expect(cache.isCacheable(CDN_SCRIPT, "POST", "script")).toBe(false);
    expect(cache.isCacheable(CDN_SCRIPT, "GET", "xhr")).toBe(false);
    expect(
      cache.isCacheable("https://www.tiktok.com/api/x", "GET", "script"),
    ).toBe(false);
    expect(cache.isCacheable("not a url", "GET", "script")).toBe(false);
  });

  test("disabled when maxBytes is 0", () => {
    const cache = new StaticAssetCache({
      maxBytes: 0,
      hostPattern: HOST_PATTERN,
    });
    expect(cache.enabled).toBe(false);
    expect(cache.isCacheable(CDN_SCRIPT, "GET", "script")).toBe(false);
  });

  test("evicts least recently used entries over the byte budget", () => {
    const cache = new StaticAssetCache({
      maxBytes: 10,
      hostPattern: HOST_PATTERN,
    });
    cache.set("a", asset(4));
    cache.set("b", asset(4));
    cache.get("a"); // a is now most recently used
    cache.set("c", asset(4));

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
    expect(cache.bytes).toBe(8);
  });

  test("ignores empty bodies and bodies larger than the whole budget", () => {
    const cache = new StaticAssetCache({
      maxBytes: 10,
      hostPattern: HOST_PATTERN,
    });
    cache.set("empty", asset(0));
    cache.set("huge", asset(11));
    expect(cache.entries.size).toBe(0);
  });

  test("replacing an entry keeps the byte count right", () => {
    const cache = new StaticAssetCache({
      maxBytes: 10,
      hostPattern: HOST_PATTERN,
    });
    cache.set("a", asset(4));
    cache.set("a", asset(6));
    expect(cache.bytes).toBe(6);
  });

  test("keeps CORS headers for replay", () => {
    expect(
      pickReplayedHeaders({
        "content-type": "application/javascript",
        "access-control-allow-origin": "*",
        "set-cookie": "x=1",
      }),
    ).toEqual({
      "content-type": "application/javascript",
      "access-control-allow-origin": "*",
    });
  });
});

describe("puppeteer glue", () => {
  const fakeRequest = (overrides = {}) => ({
    url: () => CDN_SCRIPT,
    method: () => "GET",
    resourceType: () => "script",
    respond: jest.fn(async () => {}),
    ...overrides,
  });

  test("remembers a 200 CDN response and replays it", async () => {
    const cache = new StaticAssetCache({
      maxBytes: 1000,
      hostPattern: HOST_PATTERN,
    });
    const request = fakeRequest();
    const response = {
      request: () => request,
      status: () => 200,
      headers: () => ({ "content-type": "application/javascript" }),
      buffer: async () => Buffer.from("console.log(1)"),
    };

    expect(await respondFromCache(request, cache)).toBe(false);
    await rememberResponse(response, cache);
    expect(await respondFromCache(request, cache)).toBe(true);
    expect(request.respond).toHaveBeenCalledWith({
      status: 200,
      headers: { "content-type": "application/javascript" },
      body: Buffer.from("console.log(1)"),
    });
  });

  test("skips non-200 responses and unreadable bodies", async () => {
    const cache = new StaticAssetCache({
      maxBytes: 1000,
      hostPattern: HOST_PATTERN,
    });
    const request = fakeRequest();
    await rememberResponse(
      {
        request: () => request,
        status: () => 304,
        headers: () => ({}),
        buffer: async () => Buffer.from("x"),
      },
      cache,
    );
    await rememberResponse(
      {
        request: () => request,
        status: () => 200,
        headers: () => ({}),
        buffer: async () => {
          throw new Error("redirect");
        },
      },
      cache,
    );
    expect(cache.entries.size).toBe(0);
  });
});

describe("idle reaper", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function setup({ busy = false, running = true } = {}) {
    let now = 0;
    const tracker = new ActivityTracker(() => now);
    // Like closeBrowser(): once shut down, there is nothing left running.
    const shutdown = jest.fn(async () => {
      running = false;
    });
    const stop = startIdleReaper({
      idleMs: 1000,
      checkEveryMs: 100,
      tracker,
      isRunning: () => running,
      isBusy: () => busy,
      shutdown,
      log: () => {},
    });
    const advance = async (ms) => {
      now += ms;
      await jest.advanceTimersByTimeAsync(ms);
    };
    return { tracker, shutdown, stop, advance };
  }

  test("shuts down after the idle period", async () => {
    const { shutdown, stop, advance } = setup();
    await advance(900);
    expect(shutdown).not.toHaveBeenCalled();
    await advance(200);
    expect(shutdown).toHaveBeenCalledTimes(1);
    stop();
  });

  test("never shuts down while a request is in flight", async () => {
    const { tracker, shutdown, stop, advance } = setup();
    const end = tracker.begin();
    await advance(5000);
    expect(shutdown).not.toHaveBeenCalled();
    end();
    end(); // idempotent
    expect(tracker.active).toBe(0);
    await advance(1100);
    expect(shutdown).toHaveBeenCalledTimes(1);
    stop();
  });

  test("waits for background work and for a running browser", async () => {
    const busy = setup({ busy: true });
    await busy.advance(5000);
    expect(busy.shutdown).not.toHaveBeenCalled();
    busy.stop();

    const stopped = setup({ running: false });
    await stopped.advance(5000);
    expect(stopped.shutdown).not.toHaveBeenCalled();
    stopped.stop();
  });

  test("idleMs <= 0 disables the reaper", () => {
    const stop = startIdleReaper({
      idleMs: 0,
      tracker: new ActivityTracker(),
      isRunning: () => true,
      isBusy: () => false,
      shutdown: async () => {},
    });
    expect(typeof stop).toBe("function");
  });
});
