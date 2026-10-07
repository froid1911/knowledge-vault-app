import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sizeOf, stamp } from "./backups.js";
import { gql } from "./reactor-gql.js";

/**
 * Spec §9 — export a vault as documents, in the drive-sync layout the vault
 * repo's `scripts/drive-sync/upload.py` restores (and `download.py` writes):
 *
 *   drive-info.json   { id, slug, name }
 *   tree.json         { nodes }                       the drive's node tree
 *   manifest.json     { source, folders, documents }  what upload.py walks
 *   states/<id>.json  the document's global state, its relationship fields
 *                     rebuilt from the live graph edges (links / coreIdeas / childRefs)
 *   ops/<id>.json     every operation, paged 500 at a time
 *   edges.json        the graph edges, reason and confidence included
 *   auth.json         { id: the document's access policy }
 *   llms-full.txt     the vault's REST rendering, when the engine serves it
 */
export type ExportResult = { path: string; documents: number; bytes: number; /** Documents that could not be read (the export goes on without them, as download.py does). */ failed: string[] };
export class DriveNotFoundError extends Error {}

type Node = { id: string; kind?: string; name?: string; documentType?: string; parentFolder?: string | null };
type Edge = { sourceDocumentId: string; targetDocumentId: string; linkType: string | null; reason: string | null; confidence: string | null };
type Operation = { index: number; hash?: string; timestampUtcMs?: string; action: { type: string; input: unknown; timestampUtcMs?: string } };
type OperationsPage = { items: Operation[]; hasNextPage: boolean; cursor: string | null };

/** The edge types the knowledge-note handler replays as links; CORE_IDEA / CHILD_MOC are the MoC's; the rest stay in edges.json. */
const KNOWLEDGE_NOTE_LINK_TYPES = new Set(["RELATES_TO", "BUILDS_ON", "CONTRADICTS", "SUPERSEDES", "DERIVED_FROM"]);
const PAGE = 500;

const DRIVE_QUERY = `query DriveTree($id: String!) { document(idOrSlug: $id) { document { id name slug state } } }`;
const DOC_QUERY = `query DocState($id: String!, $cursor: String) { document(idOrSlug: $id) { document { id state operations(paging: {limit: ${PAGE}, cursor: $cursor}) { items { index hash timestampUtcMs action { type input timestampUtcMs } } hasNextPage cursor } } } }`;
const EDGES_QUERY = `query Edges($driveId: ID!) { knowledgeGraphEdges(driveId: $driveId) { sourceDocumentId targetDocumentId linkType reason confidence } }`;

function asObject(v: unknown): Record<string, unknown> {
  if (typeof v === "string") {
    try {
      return asObject(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
/** The reactor returns `state` as a JSON object `{ global, local, auth, … }` (a string on older servers). */
function scopes(state: unknown): { global: Record<string, unknown>; auth: Record<string, unknown> } {
  const s = asObject(state);
  return { global: asObject(s.global), auth: asObject(s.auth) };
}
function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

async function fetchDocument(origin: string, id: string, fetchImpl: typeof fetch): Promise<{ global: Record<string, unknown>; auth: Record<string, unknown>; ops: Operation[] }> {
  const ops: Operation[] = [];
  let cursor: string | null = null;
  let first: { global: Record<string, unknown>; auth: Record<string, unknown> } | undefined;
  for (;;) {
    const variables: Record<string, unknown> = cursor === null ? { id } : { id, cursor };
    const data = await gql<{ document: { document: { state: unknown; operations: OperationsPage } } | null }>(origin, DOC_QUERY, variables, fetchImpl);
    const doc = data.document?.document;
    if (!doc) throw new Error(`document ${id} not found`);
    first ??= scopes(doc.state);
    ops.push(...(doc.operations?.items ?? []));
    if (doc.operations?.hasNextPage && doc.operations.cursor) cursor = doc.operations.cursor;
    else break;
  }
  return { ...first!, ops };
}

/** Same fields as download.py's attach_relationships_from_edges: the upload handlers read these, nothing else. */
function attachRelationships(id: string, documentType: string, state: Record<string, unknown>, bySource: Map<string, Edge[]>, titleById: Map<string, string>, addedAt: string): void {
  const links: Record<string, unknown>[] = [];
  const coreIdeas: Record<string, unknown>[] = [];
  const childRefs: string[] = [];
  const isMoc = documentType === "bai/moc";
  for (const e of bySource.get(id) ?? []) {
    const type = e.linkType ?? "";
    const tid = e.targetDocumentId;
    if (!tid) continue;
    if (KNOWLEDGE_NOTE_LINK_TYPES.has(type)) {
      const entry: Record<string, unknown> = { id: `lnk-${tid.slice(0, 8)}-${type.slice(0, 3).toLowerCase()}`, linkType: type, targetDocumentId: tid, targetTitle: titleById.get(tid) ?? "" };
      if (e.reason) entry.reason = e.reason;
      if (e.confidence) entry.confidence = e.confidence;
      links.push(entry);
    } else if (type === "CORE_IDEA" && isMoc) {
      coreIdeas.push({ id: `ci-${tid.slice(0, 8)}`, noteRef: tid, contextPhrase: e.reason ?? "", sortOrder: coreIdeas.length, addedAt, addedBy: "knowledge-agent" });
    } else if (type === "CHILD_MOC" && isMoc) {
      childRefs.push(tid);
    }
  }
  state.links = links;
  if (isMoc) {
    state.coreIdeas = coreIdeas;
    state.childRefs = childRefs;
  }
}

export async function exportVault(opts: { origin: string; driveId: string; dataDir: string; fetchImpl?: typeof fetch; now?: () => string }): Promise<ExportResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const at = (opts.now ?? (() => new Date().toISOString()))();
  const found = await gql<{ document: { document: { id: string; name: string; slug?: string | null; state: unknown } } | null }>(opts.origin, DRIVE_QUERY, { id: opts.driveId }, fetchImpl);
  const drive = found.document?.document;
  if (!drive) throw new DriveNotFoundError(`No drive ${opts.driveId} on the engine.`);
  const nodes = (scopes(drive.state).global.nodes ?? []) as Node[];
  const folders = nodes.filter((n) => n.kind === "folder");
  const files = nodes.filter((n) => n.kind === "file");
  const slug = drive.slug || opts.driveId;
  // A folder name every filesystem accepts; the export is written beside it and renamed in only when complete.
  const safe = slug.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80) || "vault";
  const finalPath = join(opts.dataDir, "exports", `${safe}-${stamp(at)}`);
  const path = `${finalPath}.partial`;
  rmSync(path, { recursive: true, force: true });
  const writeExport = async (): Promise<ExportResult> => {
  mkdirSync(join(path, "states"), { recursive: true });
  mkdirSync(join(path, "ops"), { recursive: true });
  writeJson(join(path, "drive-info.json"), { id: drive.id, slug, name: drive.name });
  writeJson(join(path, "tree.json"), { nodes });

  // The graph's edges, once — an export without its links is not a backup, so a failure here is a failure.
  const edges = (await gql<{ knowledgeGraphEdges: Edge[] }>(opts.origin, EDGES_QUERY, { driveId: drive.id }, fetchImpl, "/graphql/knowledgeGraph")).knowledgeGraphEdges ?? [];
  writeJson(join(path, "edges.json"), edges);
  const bySource = new Map<string, Edge[]>();
  for (const e of edges) bySource.set(e.sourceDocumentId, [...(bySource.get(e.sourceDocumentId) ?? []), e]);
  const titleById = new Map(files.map((f) => [f.id, f.name ?? ""]));

  const auth: Record<string, unknown> = {};
  const failed: string[] = [];
  for (const f of files) {
    let doc: Awaited<ReturnType<typeof fetchDocument>>;
    try {
      doc = await fetchDocument(opts.origin, f.id, fetchImpl);
    } catch (error) {
      console.warn(`[export] could not read ${f.id} (${f.name ?? ""}): ${error instanceof Error ? error.message : String(error)}`);
      failed.push(f.id);
      continue;
    }
    attachRelationships(f.id, f.documentType ?? "unknown", doc.global, bySource, titleById, at);
    writeJson(join(path, "states", `${f.id}.json`), doc.global);
    writeJson(join(path, "ops", `${f.id}.json`), doc.ops);
    auth[f.id] = doc.auth;
  }
  writeJson(join(path, "auth.json"), auth);

  // The vault's own rendering — useful to a reader, not needed by a restore; absent when the engine does not serve it.
  try {
    const res = await fetchImpl(`${opts.origin}/api/@powerhousedao/knowledge-note/llms-full.txt?drive=${encodeURIComponent(drive.id)}`);
    if (res.ok) writeFileSync(join(path, "llms-full.txt"), await res.text());
  } catch {
    // no REST surface
  }

  writeJson(join(path, "manifest.json"), {
    source: { endpoint: `${opts.origin}/graphql`, drive: slug, driveId: drive.id, driveName: drive.name, relationships: "graph", downloadedAt: at },
    folders: folders.map((f) => ({ id: f.id, name: f.name, parentFolder: f.parentFolder ?? null })),
    documents: files.filter((f) => !failed.includes(f.id)).map((f) => ({ id: f.id, name: f.name, type: f.documentType ?? "unknown", parentFolder: f.parentFolder ?? null })),
    ...(failed.length ? { unreadable: failed } : {}),
  });
  renameSync(path, finalPath);
  return { path: finalPath, documents: files.length - failed.length, bytes: sizeOf(finalPath), failed };
  };
  try {
    return await writeExport();
  } catch (error) {
    rmSync(path, { recursive: true, force: true });
    throw error;
  }
}
