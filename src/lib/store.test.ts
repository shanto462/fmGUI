// Tests for the app store start-up: readiness comes from the fm checks only.
// Runs the real store against the mock backend, with `window` pointed at globalThis.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockScenario } from "./mock";

async function startApp(scenario: MockScenario) {
  vi.resetModules();
  const { installMocks } = await import("./mock");
  installMocks({ scenario, timeScale: 0 });
  const store = await import("./store");
  await store.useApp.getState().load();
  return store;
}

describe("app start-up", () => {
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(async () => {
    const { uninstallMocks } = await import("./mock");
    uninstallMocks();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("opens Overview when every check passes", async () => {
    const { useApp, isLocked } = await startApp("default");
    const s = useApp.getState();
    expect(s.loaded).toBe(true);
    expect(s.route).toBe("overview");
    expect(isLocked("chat", s.status)).toBe(false);
    expect(s.toasts).toEqual([]);
  });

  it("marks setup as done on its own when a fresh install passes every check", async () => {
    const { useApp } = await startApp("setup");
    const s = useApp.getState();
    expect(s.route).toBe("overview");
    expect(s.config?.setupCompleted).toBe(true);
    expect(s.toasts.map((t) => t.text)).toEqual(["Everything is ready."]);
  });

  it("runs the start-up once when it is called twice at the same time", async () => {
    vi.resetModules();
    const { installMocks } = await import("./mock");
    installMocks({ scenario: "setup", timeScale: 0 });
    const { useApp } = await import("./store");
    await Promise.all([useApp.getState().load(), useApp.getState().load()]);
    expect(useApp.getState().toasts.map((t) => t.text)).toEqual(["Everything is ready."]);
  });

  it("opens Setup and locks pages when a check fails", async () => {
    const { useApp, isLocked } = await startApp("nolicense");
    const s = useApp.getState();
    expect(s.route).toBe("setup");
    expect(s.config?.setupCompleted).toBe(false);
    expect(isLocked("chat", s.status)).toBe(true);
    expect(isLocked("docs", s.status)).toBe(false);
    expect(isLocked("settings", s.status)).toBe(false);

    s.navigate("chat");
    expect(useApp.getState().route).toBe("setup");
  });

  it("passes the setup step to the Setup page", async () => {
    const { useApp } = await startApp("default");
    useApp.getState().navigate("setup", { setupStep: 0 });
    expect(useApp.getState().route).toBe("setup");
    expect(useApp.getState().handoff.setupStep).toBe(0);
  });
});
