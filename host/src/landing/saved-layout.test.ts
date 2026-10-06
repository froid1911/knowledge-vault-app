import { describe, expect, it } from "vitest";
import { decodeStoredLayout, positionsFor } from "./saved-layout.js";

describe("saved layout (the vault app's bai-graph-layout store, format 3)", () => {
  it("decodes ids and a Float32Array of xy pairs", () => {
    const m = decodeStoredLayout({ v: 3, ids: ["a", "b"], xy: Float32Array.from([1, 2, 3, 4]) });
    expect(m?.get("a")).toEqual({ x: 1, y: 2 });
    expect(m?.get("b")).toEqual({ x: 3, y: 4 });
  });
  it("rejects other formats and malformed values", () => {
    expect(decodeStoredLayout({ v: 1, p: {} })).toBeNull();
    expect(decodeStoredLayout({ v: 3, ids: ["a"], xy: Float32Array.from([1]) })).toBeNull();
    expect(decodeStoredLayout(null)).toBeNull();
  });
  it("uses saved positions only when they cover enough of the sample", () => {
    const saved = new Map([["a", { x: 0, y: 0 }], ["b", { x: 1, y: 1 }]]);
    expect(positionsFor(["a", "b", "c"], saved, 0.6)?.size).toBe(2);
    expect(positionsFor(["a", "b", "c", "d"], saved, 0.6)).toBeNull();
    expect(positionsFor(["a"], null, 0.6)).toBeNull();
  });
});
