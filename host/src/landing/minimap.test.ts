import { describe, expect, it } from "vitest";
import { buildMinimapScene, hasUsableLayout } from "./minimap.js";

const graph = {
  nodes: [
    { id: "m", kind: "moc" as const, status: "MOC" },
    { id: "a", kind: "note" as const, status: "CANONICAL" },
    { id: "b", kind: "note" as const, status: "DRAFT" },
    { id: "c", kind: "note" as const, status: "IN_REVIEW" }, // never laid out
  ],
  edges: [["m", "a"], ["a", "b"], ["b", "c"]] as [string, string][],
  noteCount: 3,
  linkCount: 3,
};
const positions = new Map([["m", { x: 0, y: 0 }], ["a", { x: 100, y: 0 }], ["b", { x: 100, y: 50 }]]);

describe("buildMinimapScene", () => {
  it("places the nodes the saved layout knows, fitted into the box, with segments only between placed nodes", () => {
    const scene = buildMinimapScene(graph, positions, 220, 120, 10);
    expect(scene.placed).toBe(3);
    expect(scene.total).toBe(4);
    expect(scene.points.map((p) => p.id)).toEqual(["m", "a", "b"]);
    for (const p of scene.points) {
      expect(p.x).toBeGreaterThanOrEqual(10);
      expect(p.x).toBeLessThanOrEqual(210);
      expect(p.y).toBeGreaterThanOrEqual(10);
      expect(p.y).toBeLessThanOrEqual(110);
    }
    expect(scene.points[0]).toMatchObject({ kind: "moc", status: "MOC" });
    expect(scene.segments).toHaveLength(2); // m–a and a–b; b–c has an unplaced end
  });
  it("reports coverage so a tile can fall back when the layout is too partial", () => {
    expect(buildMinimapScene(graph, positions, 220, 120).coverage).toBeCloseTo(0.75);
    expect(buildMinimapScene(graph, new Map(), 220, 120)).toMatchObject({ placed: 0, coverage: 0, points: [], segments: [] });
  });

  it("decides when the saved layout is good enough to show the whole graph", () => {
    expect(hasUsableLayout(graph, positions)).toBe(true); // 3 of 4
    expect(hasUsableLayout(graph, new Map([["m", { x: 0, y: 0 }]]))).toBe(false); // 1 of 4
    expect(hasUsableLayout(graph, null)).toBe(false);
    expect(hasUsableLayout({ ...graph, nodes: [] }, positions)).toBe(false);
  });
});
