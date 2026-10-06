import { describe, expect, it, vi } from "vitest";
import { buildSample, chooseSeed, fetchVaultGraph, forwardLinksQuery, graphEndpoint } from "./graph.js";

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
  it("seeds from the map of content with the most outgoing links, else the most recent node", () => {
    const moc = (id: string, outDegree: number) => ({ ...node(id, "MOC", "bai/moc"), outDegree });
    expect(chooseSeed([moc("small", 2), moc("hub", 9), moc("empty", 0)], [node("r1")])?.documentId).toBe("hub");
    expect(chooseSeed([moc("empty", 0)], [node("r1"), node("r2")])?.documentId).toBe("r1");
    expect(chooseSeed([], [])).toBeNull();
  });
  it("falls back to the recent nodes when the walk from the seed comes back thin (a leaf seed gave a single dot)", async () => {
    const recent = [node("leaf", "IN_REVIEW"), node("n2"), node("n3", "DRAFT")];
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const q = JSON.parse(init.body).query as string;
      if (q.includes("knowledgeGraphStats")) return new Response(JSON.stringify({ data: { stats: { noteCount: 24, edgeCount: 43, mocCount: 0 }, mocs: [], recent } }));
      if (q.includes("knowledgeGraphConnections")) return new Response(JSON.stringify({ data: { connections: [] } }));
      return new Response(JSON.stringify({ data: { l0: [{ sourceDocumentId: "n2", targetDocumentId: "leaf", linkType: "BUILDS_ON" }], l1: [], l2: [] } }));
    });
    const sample = await fetchVaultGraph("http://127.0.0.1:4201", "d1", { maxNodes: 28 }, fetchImpl as unknown as typeof fetch);
    expect(sample.nodes.map((n) => n.id)).toEqual(["leaf", "n2", "n3"]);
    expect(sample.edges).toEqual([["n2", "leaf"]]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("returns counts with an empty sample for a vault without notes, after one request", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { stats: { noteCount: 0, edgeCount: 0, mocCount: 0 }, mocs: [], recent: [] } })));
    const sample = await fetchVaultGraph("http://127.0.0.1:4201", "d1", { maxNodes: 40 }, fetchImpl as unknown as typeof fetch);
    expect(sample).toEqual({ noteCount: 0, linkCount: 0, mocCount: 0, nodes: [], edges: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
