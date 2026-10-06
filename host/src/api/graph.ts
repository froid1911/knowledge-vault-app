/**
 * A vault's numbers and a small, truthful sample of its graph for the landing
 * tiles: the most recently edited note as a seed, its neighbourhood two links
 * out (nodes with their status, for colour), and the knowledge edges among
 * them — three small requests, never the whole graph.
 */
export type GraphNodeLite = { id: string; kind: "note" | "moc"; status: string | null };
export type VaultGraphSample = {
  noteCount: number;
  linkCount: number;
  mocCount: number;
  nodes: GraphNodeLite[];
  edges: [string, string][];
};

type Stats = { noteCount: number; edgeCount: number; mocCount: number };
type RawNode = { documentId: string; status: string | null; documentType: string | null };
type RawConnection = { node: RawNode; depth: number };
type RawMoc = RawNode & { outDegree: number };
type RawLink = { sourceDocumentId: string; targetDocumentId: string; linkType: string | null };

const DERIVED = new Set(["INVOLVES", "PROMOTED_TO"]);
const LINKS_PER_SAMPLE = 12;

/**
 * Where to start the sample: the map of content with the most outgoing links
 * (the vault's structure, and the walk follows outgoing edges), else the most
 * recently edited node. A leaf note as a seed would yield a single dot.
 */
export function chooseSeed(mocs: readonly RawMoc[], recent: readonly RawNode[]): RawNode | null {
  const hub = [...mocs].filter((m) => m.outDegree > 0).sort((a, b) => b.outDegree - a.outDegree)[0];
  return hub ?? recent[0] ?? null;
}

const MIN_CONNECTED = 3;

export function graphEndpoint(origin: string): string {
  return `${origin}/graphql/knowledgeGraph`;
}

export function forwardLinksQuery(ids: readonly string[]): string {
  const fields = ids
    .map((id, i) => `l${i}: knowledgeGraphForwardLinks(driveId: $driveId, documentId: ${JSON.stringify(id)}) { sourceDocumentId targetDocumentId linkType }`)
    .join("\n");
  return `query Links($driveId: ID!) {\n${fields}\n}`;
}

function kindOf(n: RawNode): GraphNodeLite["kind"] | null {
  if (n.documentType === "bai/moc") return "moc";
  if (n.documentType === "bai/knowledge-note" || n.documentType === "bai/research-claim") return "note";
  return null;
}

export function buildSample(input: {
  stats: Stats;
  seed: RawNode | null;
  connections: RawConnection[];
  links: RawLink[];
  maxNodes: number;
}): VaultGraphSample {
  const nodes: GraphNodeLite[] = [];
  const seen = new Set<string>();
  const push = (n: RawNode) => {
    const kind = kindOf(n);
    if (!kind || seen.has(n.documentId) || nodes.length >= input.maxNodes) return;
    seen.add(n.documentId);
    nodes.push({ id: n.documentId, kind, status: n.status });
  };
  if (input.seed) push(input.seed);
  for (const c of [...input.connections].sort((a, b) => a.depth - b.depth)) push(c.node);
  const edges: [string, string][] = [];
  const pairs = new Set<string>();
  for (const l of input.links) {
    if (l.linkType && DERIVED.has(l.linkType)) continue;
    if (!seen.has(l.sourceDocumentId) || !seen.has(l.targetDocumentId) || l.sourceDocumentId === l.targetDocumentId) continue;
    const key = [l.sourceDocumentId, l.targetDocumentId].sort().join("\u0000");
    if (pairs.has(key)) continue;
    pairs.add(key);
    edges.push([l.sourceDocumentId, l.targetDocumentId]);
  }
  return { noteCount: input.stats.noteCount, linkCount: input.stats.edgeCount, mocCount: input.stats.mocCount, nodes, edges };
}

async function gql<T>(url: string, query: string, variables: Record<string, unknown>, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
  if (!res.ok) throw new Error(`The engine answered HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error("The engine answered without data");
  return json.data;
}

export async function fetchVaultGraph(
  origin: string,
  driveId: string,
  opts: { maxNodes: number },
  fetchImpl: typeof fetch = fetch,
): Promise<VaultGraphSample> {
  const url = graphEndpoint(origin);
  const first = await gql<{ stats: Stats; mocs: RawMoc[]; recent: RawNode[] }>(
    url,
    `query Vault($driveId: ID!, $limit: Int!) {
      stats: knowledgeGraphStats(driveId: $driveId) { noteCount edgeCount mocCount }
      mocs: knowledgeGraphNodesByStatus(driveId: $driveId, status: "MOC") { documentId status documentType outDegree }
      recent: knowledgeGraphRecent(driveId: $driveId, limit: $limit) { documentId status documentType }
    }`,
    { driveId, limit: opts.maxNodes },
    fetchImpl,
  );
  const seed = chooseSeed(first.mocs, first.recent);
  if (!seed || first.stats.noteCount === 0) return buildSample({ stats: first.stats, seed: null, connections: [], links: [], maxNodes: opts.maxNodes });
  const second = await gql<{ connections: RawConnection[] }>(
    url,
    `query Around($driveId: ID!, $seed: String!) {
      connections: knowledgeGraphConnections(driveId: $driveId, documentId: $seed, depth: 2) { node { documentId status documentType } depth }
    }`,
    { driveId, seed: seed.documentId },
    fetchImpl,
  );
  // A thin walk (a seed with few outgoing links) falls back to the most recently edited nodes.
  let connections = second.connections;
  let provisional = buildSample({ stats: first.stats, seed, connections, links: [], maxNodes: opts.maxNodes });
  if (provisional.nodes.length < MIN_CONNECTED) {
    connections = first.recent.map((node) => ({ node, depth: 1 }));
    provisional = buildSample({ stats: first.stats, seed, connections, links: [], maxNodes: opts.maxNodes });
  }
  const ids = provisional.nodes.slice(0, LINKS_PER_SAMPLE).map((n) => n.id);
  let links: RawLink[] = [];
  if (ids.length > 0) {
    const third = await gql<Record<string, RawLink[]>>(url, forwardLinksQuery(ids), { driveId }, fetchImpl);
    links = Object.values(third).flat();
  }
  return buildSample({ stats: first.stats, seed, connections, links, maxNodes: opts.maxNodes });
}
