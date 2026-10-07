import { describe, expect, it } from "vitest";
import { createOAuthStore } from "./oauth.js";

describe("one-shot OAuth callbacks", () => {
  it("hands a code to the window exactly once, for a sign-in it started, within ten minutes", () => {
    let t = 0;
    const store = createOAuthStore(() => t);
    const { nonce } = store.start();
    expect(nonce).toMatch(/^[0-9a-f]{48}$/);
    expect(store.take(nonce)).toEqual({ state: "pending" });
    expect(store.receive(nonce, "abc")).toBe(true);
    expect(store.receive(nonce, "second")).toBe(false); // one code per sign-in
    expect(store.take(nonce)).toEqual({ state: "done", code: "abc" });
    expect(store.take(nonce)).toEqual({ state: "unknown" }); // taken once
    expect(store.receive("not-started", "x")).toBe(false);
    const late = store.start();
    t = 11 * 60_000;
    expect(store.receive(late.nonce, "too-late")).toBe(false);
    expect(store.take(late.nonce)).toEqual({ state: "unknown" });
  });
});
