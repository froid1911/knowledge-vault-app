// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useReturnHomeAfterSignIn } from "./return-home-after-sign-in.js";

describe("useReturnHomeAfterSignIn", () => {
  it("returns to the landing when a sign-in completes on the Identity page", () => {
    const goHome = vi.fn();
    const { rerender } = renderHook(({ auth, page }) => useReturnHomeAfterSignIn(auth, page, goHome), { initialProps: { auth: false as boolean | undefined, page: true } });
    expect(goHome).not.toHaveBeenCalled();
    rerender({ auth: true, page: true });
    expect(goHome).toHaveBeenCalledTimes(1);
  });

  it("stays put when the app loads already signed in, on sign-out, or away from the Identity page", () => {
    const goHome = vi.fn();
    const { rerender } = renderHook(({ auth, page }) => useReturnHomeAfterSignIn(auth, page, goHome), { initialProps: { auth: undefined as boolean | undefined, page: true } });
    rerender({ auth: true, page: true }); // the first status read, already signed in
    rerender({ auth: false, page: true }); // signed out
    rerender({ auth: true, page: false }); // signed in while elsewhere
    expect(goHome).not.toHaveBeenCalled();
  });
});
