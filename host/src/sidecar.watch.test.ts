import { afterEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen }));

import { watchSidecar, type SidecarStatus } from "./sidecar.js";

type Handler = (event: { payload: unknown }) => void;
const ready = { state: "ready", ready: { port: 4201, controlPort: 4202, controlToken: "t" }, code: null };

describe("watchSidecar under Tauri", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("never lets the initial snapshot overwrite a newer event", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    let handler: Handler | undefined;
    const off = vi.fn();
    listen.mockImplementation(async (_name: string, cb: Handler) => {
      handler = cb;
      return off;
    });
    let answer: ((v: unknown) => void) | undefined;
    invoke.mockImplementation(() => new Promise((r) => { answer = r; }));
    const seen: string[] = [];
    const stop = watchSidecar((s: SidecarStatus) => seen.push(s.state));
    await vi.waitFor(() => expect(answer).toBeDefined());
    handler!({ payload: ready }); // the event arrives while the snapshot is in flight
    answer!({ state: "starting", ready: null, code: null }); // …and the snapshot is older
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(["ready"]);
    stop();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes when cleaned up before the subscription resolved", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    const off = vi.fn();
    let resolveListen: ((v: unknown) => void) | undefined;
    listen.mockImplementation(() => new Promise((r) => { resolveListen = r; }));
    const stop = watchSidecar(() => {});
    await vi.waitFor(() => expect(resolveListen).toBeDefined());
    stop();
    resolveListen!(off);
    await new Promise((r) => setTimeout(r, 0));
    expect(off).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports a failure instead of waiting forever when the shell API is unreachable", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    listen.mockRejectedValue(new Error("no ipc"));
    const seen: SidecarStatus[] = [];
    watchSidecar((s) => seen.push(s));
    await vi.waitFor(() => expect(seen[0]?.state).toBe("failed"));
    expect(seen[0]).toEqual({ state: "failed", detail: "no ipc" });
  });
});
