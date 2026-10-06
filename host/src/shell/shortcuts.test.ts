import { describe, expect, it } from "vitest";
import { matchShortcut } from "./shortcuts.js";

const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("matchShortcut", () => {
  it("recognises the two shortcuts with Ctrl or ⌘ and nothing else", () => {
    expect(matchShortcut(k("n", { ctrlKey: true }))).toBe("new-vault");
    expect(matchShortcut(k("N", { metaKey: true }))).toBe("new-vault");
    expect(matchShortcut(k(",", { ctrlKey: true }))).toBe("settings");
    expect(matchShortcut(k("n"))).toBeNull();
    expect(matchShortcut(k("n", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchShortcut(k("n", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});
