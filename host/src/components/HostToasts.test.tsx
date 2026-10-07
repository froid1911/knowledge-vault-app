// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostToasts, createToastStore } from "./HostToasts.js";

afterEach(cleanup);

describe("HostToasts", () => {
  it("shows what an app reports through the toast service, errors as alerts", () => {
    const store = createToastStore();
    render(<HostToasts store={store} />);
    act(() => store.toast("Failed to create Connection", { type: "error" }));
    expect(screen.getByRole("alert").textContent).toContain("Failed to create Connection");
    act(() => store.toast("Workflow deleted"));
    expect(screen.getByRole("status").textContent).toContain("Workflow deleted");
  });

  it("closes a toast on its button and on its own after a while", () => {
    vi.useFakeTimers();
    const store = createToastStore();
    render(<HostToasts store={store} />);
    act(() => store.toast("one"));
    act(() => store.toast("two", { type: "error" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss" })[0]!);
    expect(screen.queryByText("one")).toBeNull();
    act(() => vi.advanceTimersByTime(8_000));
    expect(screen.queryByText("two")).toBeNull();
    vi.useRealTimers();
  });
});
