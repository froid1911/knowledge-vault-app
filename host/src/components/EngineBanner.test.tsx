// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EngineBanner } from "./EngineBanner.js";

afterEach(cleanup);
describe("EngineBanner", () => {
  it("says the app is reconnecting while the engine is degraded, and renders nothing otherwise", () => {
    const { rerender } = render(<EngineBanner health="degraded" />);
    expect(screen.getByRole("status").textContent).toContain("Reconnecting…");
    rerender(<EngineBanner health="ok" />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
