// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { installHistoryGuard } from "./history-guard.js";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("history guard — the shell's hash route stays authoritative", () => {
  it("rewrites Connect-style path writes to the root and keeps the current hash", () => {
    const uninstall = installHistoryGuard();
    window.location.hash = "#/vault/abc";
    window.history.pushState(null, "", "/d/research-notes");
    expect(window.location.pathname).toBe("/");
    expect(window.location.hash).toBe("#/vault/abc");
    window.location.hash = "#/settings/models";
    window.history.pushState(null, "", "/");
    expect(`${window.location.pathname}${window.location.hash}`).toBe("/#/settings/models");
    window.history.replaceState(null, "", "/d/research-notes/some-node");
    expect(`${window.location.pathname}${window.location.hash}`).toBe("/#/settings/models");
    uninstall();
  });
  it("lets a write that carries its own hash through, and keeps the query string", () => {
    const uninstall = installHistoryGuard();
    window.location.hash = "#/vault/abc";
    window.history.pushState(null, "", "/#/workflows");
    expect(`${window.location.pathname}${window.location.hash}`).toBe("/#/workflows");
    window.history.replaceState(null, "", "/?user=0xabc");
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe("/?user=0xabc#/workflows");
    uninstall();
  });
  it("does not add a history entry for a write that changes nothing", () => {
    const uninstall = installHistoryGuard();
    window.location.hash = "#/vault/abc";
    const before = window.history.length;
    window.history.pushState(null, "", "/d/research-notes"); // becomes /#/vault/abc — where we already are
    expect(window.history.length).toBe(before);
    uninstall();
  });
});
