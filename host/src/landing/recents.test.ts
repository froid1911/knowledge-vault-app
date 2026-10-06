import { describe, expect, it } from "vitest";
import { formatOpened, readRecents, rememberOpened, sortByRecency } from "./recents.js";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 };
}

describe("recents", () => {
  it("remembers when a vault was opened and reads it back", () => {
    const s = memoryStorage();
    rememberOpened(s, "v1", new Date("2026-10-06T10:00:00Z"));
    expect(readRecents(s)).toEqual({ v1: "2026-10-06T10:00:00.000Z" });
  });
  it("survives a corrupt store", () => {
    const s = memoryStorage();
    s.setItem("kv.recents", "{not json");
    expect(readRecents(s)).toEqual({});
  });
  it("sorts the most recently opened first, unopened last by name", () => {
    const recents = { b: "2026-10-05T00:00:00Z", c: "2026-10-06T00:00:00Z" };
    const vaults = [{ id: "a", name: "Zeta" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }, { id: "d", name: "Alpha" }];
    expect(sortByRecency(vaults, recents).map((v) => v.id)).toEqual(["c", "b", "d", "a"]);
  });
  it("describes when a vault was opened in plain words", () => {
    const now = new Date("2026-10-06T12:00:00Z");
    expect(formatOpened(undefined, now)).toBe("not opened yet");
    expect(formatOpened("2026-10-06T11:59:40Z", now)).toBe("opened just now");
    expect(formatOpened("2026-10-06T11:35:00Z", now)).toBe("opened 25 minutes ago");
    expect(formatOpened("2026-10-06T09:00:00Z", now)).toBe("opened 3 hours ago");
    expect(formatOpened("2026-10-05T12:00:00Z", now)).toBe("opened yesterday");
    expect(formatOpened("2026-10-02T12:00:00Z", now)).toBe("opened 4 days ago");
    expect(formatOpened("2026-08-12T12:00:00Z", now)).toBe("opened on 12 August");
  });
});
