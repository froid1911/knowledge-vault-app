// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadNotice, type DownloadEvents } from "./DownloadNotice.js";

afterEach(cleanup);

function events() {
  let emit: (e: { success: boolean; path: string | null; cancelled?: boolean }) => void = () => {};
  const subscribe: DownloadEvents = (cb) => {
    emit = cb;
    return () => {};
  };
  return { subscribe, emit: (e: { success: boolean; path: string | null; cancelled?: boolean }) => act(() => emit(e)) };
}

describe("DownloadNotice", () => {
  it("says where a download was saved and shows it in the file manager", () => {
    const ev = events();
    const reveal = vi.fn();
    render(<DownloadNotice subscribe={ev.subscribe} reveal={reveal} />);
    expect(screen.queryByRole("status")).toBeNull();
    ev.emit({ success: true, path: "/home/u/Downloads/report (1).pdf" });
    expect(screen.getByRole("status").textContent).toContain("Saved report (1).pdf to Downloads.");
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(reveal).toHaveBeenCalledWith("/home/u/Downloads/report (1).pdf");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("says so when a download failed", () => {
    const ev = events();
    render(<DownloadNotice subscribe={ev.subscribe} reveal={() => {}} />);
    ev.emit({ success: false, path: null });
    expect(screen.getByRole("alert").textContent).toContain("The download did not finish");
  });
  it("says nothing when the user cancels the Save dialog", () => {
    const ev = events();
    render(<DownloadNotice subscribe={ev.subscribe} reveal={vi.fn()} />);
    ev.emit({ success: true, path: null, cancelled: true });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
