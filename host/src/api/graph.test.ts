import { describe, expect, it, vi } from "vitest";
import { buildSample, fetchVaultGraph, forwardLinksQuery, graphEndpoint } from "./graph.js";

const node = (id: string, status: string | null = "CANONICAL", documentType = "bai/knowledge-note") => ({ documentId: id, status, documentType });

describe("graph sampling", () => {
  it("names the knowledge-graph subgraph endpoint from the engine origin", () => {
    expect(graphEndpoint("http://127.0.0.1:4201")).toBe("http://127.0.0.1:4201/graphql/knowledgeGraph");
  });
  it("asks for the forward links of several nodes in one aliased request", () => {
    const q = forwardLinksQuery(["a", "b"]);
    expect(q).toContain("l0: knowledgeGraphForwardLinks(driveId: $driveId, documentId: \"a\")");
    expect(q).toContain("l1: knowledgeGraphForwardLinks(driveId: $driveId, documentId: \"b\")");
  });
  it("keeps notes and MoCs, caps the sample nearest-first, and keeps only knowledge edges inside it", () => {
    const sample = buildSample({
      stats: { noteCount: 120, edgeCount: 400, mocCount: 8 },
      seed: node("seed"),
      connections: [
        { node: node("m1", "MOC", "bai/moc"), depth: 1 },
        { node: node("t1", "OPEN", "bai/tension"), depth: 1 },
        { node: node("n2", "DRAFT"), depth: 2 },
        { node: node("n3", "IN_REVIEW"), depth: 2 },
      ],
      links: [
        { sourceDocumentId: "seed", targetDocumentId: "m1", linkType: "RELATES_TO" },
        { sourceDocumentId: "m1", targetDocumentId: "seed", linkType: "CORE_IDEA" }, // same pair, other direction
        { sourceDocumentId: "t1", targetDocumentId: "seed", linkType: "INVOLVES" }, // derived, and t1 is not in the sample
        { sourceDocumentId: "n2", targetDocumentId: "zzz", linkType: "BUILDS_ON" }, // outside the sample
        { sourceDocumentId: "n3", targetDocumentId: "n2", linkType: "BUILDS_ON" },
      ],
      maxNodes: 3,
    });
    expect(sample.noteCount).toBe(120);
    expect(sample.linkCount).toBe(400);
    expect(sample.nodes.map((n) => n.id)).toEqual(["seed", "m1", "n2"]);
    expect(sample.nodes[1]).toEqual({ id: "m1", kind: "moc", status: "MOC" });
    expect(sample.edges).toEqual([["seed", "m1"]]);
  });
  it("returns counts with an empty sample for a vault without notes, after one request", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { stats: { noteCount: 0, edgeCount: 0, mocCount: 0 }, recent: [] } })));
    const sample = await fetchVaultGraph("http://127.0.0.1:4201", "d1", { maxNodes: 40 }, fetchImpl as unknown as typeof fetch);
    expect(sample).toEqual({ noteCount: 0, linkCount: 0, mocCount: 0, nodes: [], edges: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
