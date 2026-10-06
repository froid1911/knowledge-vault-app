// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installExternalLinks, shouldOpenExternally } from "./links.js";

const here = "http://127.0.0.1:4200";

describe("shouldOpenExternally", () => {
  it("sends other web origins to the system browser and keeps the app's own and the engine's", () => {
    expect(shouldOpenExternally("https://openrouter.ai/auth?callback_url=x", here)).toBe(true);
    expect(shouldOpenExternally("https://www.renown.id/", here)).toBe(true);
    expect(shouldOpenExternally("mailto:team@example.com", here)).toBe(true);
    expect(shouldOpenExternally("/vault/abc", here)).toBe(false);
    expect(shouldOpenExternally("http://127.0.0.1:4201/graphql", here)).toBe(false);
    expect(shouldOpenExternally("http://localhost:4200/x", here)).toBe(false);
    expect(shouldOpenExternally("javascript:void(0)", here)).toBe(false);
    expect(shouldOpenExternally("not a url", here)).toBe(false);
  });
});

describe("installExternalLinks", () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => { uninstall?.(); document.body.innerHTML = ""; });

  it("intercepts clicks on external anchors and window.open, leaves the app's own links alone", () => {
    const open = vi.fn();
    uninstall = installExternalLinks(open);
    document.body.innerHTML = '<a id="ext" href="https://openrouter.ai/auth">login</a><a id="own" href="/vault/1">vault</a>';
    const ext = document.getElementById("ext")!;
    const own = document.getElementById("own")!;
    const extEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    ext.dispatchEvent(extEvent);
    expect(open).toHaveBeenCalledWith("https://openrouter.ai/auth");
    expect(extEvent.defaultPrevented).toBe(true);
    const ownEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
    own.dispatchEvent(ownEvent);
    expect(ownEvent.defaultPrevented).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(window.open("https://www.renown.id/?x=1", "_blank")).toBeNull();
    expect(open).toHaveBeenLastCalledWith("https://www.renown.id/?x=1");
  });
});
