// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Boot } from "./boot.js";
import type { SidecarStatus } from "./sidecar.js";

// boot.tsx needs only the theme hooks from reactor-browser; the real module drags the whole client in.
vi.mock("@powerhousedao/reactor-browser", () => ({
  initTheme: () => {},
  useTheme: () => ({ theme: "dark", isSystem: false, setTheme: () => {} }),
}));

afterEach(() => cleanup());

function fakeWatcher() {
  let cb: ((s: SidecarStatus) => void) | undefined;
  return {
    watch: (on: (s: SidecarStatus) => void) => {
      cb = on;
      return () => {
        cb = undefined;
      };
    },
    emit: (s: SidecarStatus) => act(() => cb?.(s)),
  };
}
const info = { origin: "http://127.0.0.1:4301", graphqlUrl: "http://127.0.0.1:4301/graphql", controlOrigin: "http://127.0.0.1:4302", controlToken: "t" };

describe("Boot", () => {
  it("shows the engine starting, then the vault app once the shell reports ready", async () => {
    const w = fakeWatcher();
    const load = vi.fn(async () => ({ App: () => <p>the app</p>, client: {} as never }));
    render(<Boot watch={w.watch} load={load} />);
    expect(screen.getByText("Starting the engine…")).toBeTruthy();
    w.emit({ state: "ready", info });
    await waitFor(() => expect(screen.getByText("the app")).toBeTruthy());
    expect(load).toHaveBeenCalledWith(info);
    expect(document.documentElement.dataset.baiTheme).toBe("dark");
  });

  it("reports an engine that exited instead of waiting forever", () => {
    const w = fakeWatcher();
    render(<Boot watch={w.watch} load={vi.fn()} />);
    w.emit({ state: "exited", code: 1 });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("The engine stopped")).toBeTruthy();
    expect(screen.getByText(/Exit code 1/)).toBeTruthy();
  });

  it("reports a vault app that failed to load", async () => {
    const w = fakeWatcher();
    render(<Boot watch={w.watch} load={vi.fn(async () => { throw new Error("chunk missing"); })} />);
    w.emit({ state: "ready", info });
    await waitFor(() => expect(screen.getByText("The vault app could not load")).toBeTruthy());
    expect(screen.getByText("chunk missing")).toBeTruthy();
  });
});
