#!/usr/bin/env node
// A demo vault with real notes, MoCs and links on a local engine — for screenshots and manual testing.
// The vault is created through the control API (so it is a real vault), the content through the
// engine's GraphQL. Notes land at the drive root; the vault app scaffolds its folders on first open.
//
//   node scripts/seed-demo-vault.mjs --name "Research notes" --size large
//   node scripts/seed-demo-vault.mjs --name "Team wiki" --size small
//   options: --origin http://127.0.0.1:4201 --control http://127.0.0.1:4202 --token dev-token
import { randomUUID } from "node:crypto";

const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; };
const ORIGIN = arg("--origin", "http://127.0.0.1:4201");
const CONTROL = arg("--control", "http://127.0.0.1:4202");
const TOKEN = arg("--token", "dev-token");
const NAME = arg("--name", "Research notes");
const SIZE = arg("--size", "large");
const now = () => new Date().toISOString();

async function gql(query, variables = {}, path = "/graphql") {
  const res = await fetch(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data;
}
async function control(path, init) {
  const res = await fetch(`${CONTROL}${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" } });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `control ${res.status}`);
  return body;
}
// Return shapes differ by stack version: select nothing for scalars, __typename for objects.
async function selectionFor(fieldName) {
  const d = await gql(`{ __type(name:"Mutation"){ fields { name type { kind name ofType { kind name } } } } }`);
  const f = d.__type.fields.find((x) => x.name === fieldName);
  let t = f.type; while (t && !t.name) t = t.ofType;
  return t && t.kind === "OBJECT" ? " { __typename }" : "";
}
const SEL = { execute: await selectionFor("execute"), addRelationship: await selectionFor("addRelationship") };
const act = (type, input) => ({ id: randomUUID(), type, timestampUtcMs: now(), input, scope: "global" });
async function execute(id, actions) {
  await gql(`mutation($id: String!, $actions: [ActionInput!]!) { execute(documentIdOrSlug: $id, actions: $actions)${SEL.execute} }`, { id, actions });
}
async function link(source, target, type, metadata) {
  await gql(`mutation($s: String!, $t: String!, $type: String!, $m: JSONObject) { addRelationship(sourceIdOrSlug: $s, targetIdOrSlug: $t, relationshipType: $type, metadata: $m)${SEL.addRelationship} }`, { s: source, t: target, type, m: metadata ?? {} });
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// ---- content: claims about working a knowledge vault, as declarative titles ----
const LARGE = {
  mocs: [
    { key: "hub", title: "Working a knowledge vault", tier: "HUB", description: "The entry point: how notes, maps and the pipeline fit together.", orientation: "Start with the two topics below; each holds the claims that matter most for its area." },
    { key: "notes", title: "Atomic notes and their links", tier: "TOPIC", parent: "hub", description: "What makes a note worth keeping and a link worth drawing.", orientation: "Read the claims about atomicity first, then the ones about articulation." },
    { key: "graph", title: "Reading the graph", tier: "TOPIC", parent: "hub", description: "Density, orphans, bridges and what they say about a vault.", orientation: "These claims explain the health report's numbers." },
  ],
  notes: [
    ["A note makes exactly one claim, stated in its title", "notes", "concept", "CANONICAL", "One claim per note keeps links precise: a link to a note is a link to a single idea, not to a page that happens to mention it."],
    ["A description adds information the title does not carry", "notes", "concept", "CANONICAL", "The description is the second layer of disclosure; repeating the title wastes it."],
    ["Every link passes the articulation test", "notes", "principle", "CANONICAL", "A connects to B because of a reason a reader can check. A link without a reason is an address-book entry."],
    ["The reason for a link lives on the edge, not in the body", "notes", "pattern", "CANONICAL", "Stored on the relationship, the reason can be counted, searched and audited; in prose it cannot."],
    ["Two typed links are the floor for a new note", "notes", "principle", "IN_REVIEW", "A note with fewer than two connections is not yet placed in the vault's structure."],
    ["Maps of content are navigation, not knowledge", "notes", "concept", "CANONICAL", "A MoC collects core ideas; its own value is the ordering and the orientation text."],
    ["A topic with three or more notes earns a map", "notes", "procedure", "DRAFT", "Below three notes a map is noise; above nine it should split."],
    ["Confidence is a vocabulary of three words", "notes", "reference", "CANONICAL", "grounded, established, speculative — nothing else, so the words stay comparable across the vault."],
    ["Superseding retires a claim without deleting it", "notes", "procedure", "CANONICAL", "The new note links SUPERSEDES to the old one, which is archived; history and backlinks survive."],
    ["Deleting a note breaks provenance in three places", "notes", "observation", "IN_REVIEW", "The source's extracted claims, the derived-from edges and every citation point at a hole."],
    ["Skip rate is reported, never massaged", "notes", "principle", "DRAFT", "A high skip rate on a thin source is the finding; rounding it away hides a low-yield source."],
    ["An orphan is a node with no incoming edge", "graph", "concept", "CANONICAL", "Outgoing links do not rescue a note nobody points at; the definition is incoming only."],
    ["Density measures how connected the vault is", "graph", "concept", "CANONICAL", "Edges over possible edges among knowledge nodes; derived edges are excluded."],
    ["A bridge is a note whose removal splits the graph", "graph", "concept", "IN_REVIEW", "Bridges mark where one cluster depends on a single idea to reach another."],
    ["Triangles are synthesis opportunities", "graph", "pattern", "CANONICAL", "Two notes that share a target but not each other often belong in one new claim."],
    ["Semantic similarity finds neighbours links missed", "graph", "pattern", "DRAFT", "The embedding neighbourhood of a note suggests links the author did not draw."],
    ["Articulated coverage is edges with a reason over all edges", "graph", "reference", "CANONICAL", "The health report's link-quality number; it rises only by writing reasons."],
    ["Open tensions are tracked, not resolved by deletion", "graph", "procedure", "CANONICAL", "A contradiction gets a tension document; resolving or dissolving it is a decision with a record."],
    ["The hub is the single map with no parent", "graph", "concept", "CANONICAL", "A well-kept vault has exactly one map without an incoming child-map edge."],
    ["Stale notes are found by edit time, not creation time", "graph", "observation", "DRAFT", "A note created long ago but changed today is current; staleness follows the last edit."],
    ["The graph index is a projection, rebuildable at will", "graph", "architecture", "CANONICAL", "Nothing lives only in the index; a reindex rebuilds it from the documents."],
    ["Health is read from the last report only", "graph", "observation", "IN_REVIEW", "Repair after a run leaves the dashboard showing stale problems until the report is rewritten."],
    ["A truthful warning outranks a fabricated pass", "notes", "principle", "CANONICAL", "The report directs attention; gaming it destroys the only signal the vault has about itself."],
    ["Progressive disclosure runs title, description, content", "notes", "pattern", "CANONICAL", "Each layer adds detail the previous one lacked; a reader stops when they have enough."],
  ],
  links: [
    [0, 1, "BUILDS_ON", "the description layer only works once the title carries exactly one claim"],
    [0, 23, "RELATES_TO", "both describe the layered shape of a note"],
    [2, 3, "BUILDS_ON", "storing the reason on the edge is how the articulation test becomes checkable"],
    [2, 16, "RELATES_TO", "articulated coverage is the articulation test measured across the vault"],
    [4, 11, "RELATES_TO", "the two-link floor is what keeps a new note from being an orphan"],
    [5, 6, "BUILDS_ON", "the three-note threshold decides when navigation is worth creating"],
    [5, 18, "BUILDS_ON", "the hub is the root of the navigation the maps form"],
    [8, 9, "BUILDS_ON", "superseding exists because deletion breaks provenance"],
    [10, 22, "RELATES_TO", "both refuse to improve a number by lying about it"],
    [12, 11, "RELATES_TO", "density and orphans are two views of the same edge population"],
    [13, 14, "RELATES_TO", "bridges and triangles both come from the graph's shape, not its content"],
    [15, 14, "BUILDS_ON", "similarity proposes the links that would close triangles"],
    [17, 2, "RELATES_TO", "a tension is a link whose reason is a disagreement"],
    [19, 21, "RELATES_TO", "both are about what the report shows and when"],
    [20, 12, "BUILDS_ON", "density is computed over the projection the index holds"],
    [21, 22, "BUILDS_ON", "the last-report rule is why a fabricated pass is so costly"],
    [7, 2, "RELATES_TO", "confidence is the second word written on an edge beside its reason"],
  ],
};
const SMALL = {
  mocs: [{ key: "ops", title: "Team conventions", tier: "TOPIC", description: "How the team writes and reviews notes.", orientation: "Short, operational claims." }],
  notes: [
    ["Review approves from a different account than the author", "ops", "procedure", "CANONICAL", "Approval is only legal from in-review, by a different actor."],
    ["Sources are queued, not extracted by hand", "ops", "workflow", "CANONICAL", "Queue for processing sets the status and adds the task; the pipeline does the rest."],
    ["Meeting notes are sources, not notes", "ops", "concept", "IN_REVIEW", "They enter as sources and leave as atomic claims."],
    ["A pipeline run ends with a rewritten health report", "ops", "procedure", "DRAFT", "The dashboard shows the last report; a run that skips it leaves stale findings."],
    ["Topics use the vault's existing vocabulary", "ops", "principle", "CANONICAL", "A new topic name is a decision; check the topic list first."],
    ["Descriptions stay under two hundred characters", "ops", "reference", "CANONICAL", "The one hard limit the reducers enforce; longer descriptions are dropped silently."],
    ["Archived notes leave search but keep their history", "ops", "concept", "DRAFT", "Retirement, not deletion."],
  ],
  links: [[0, 2, "RELATES_TO", "both are about how material moves through review"], [1, 3, "BUILDS_ON", "the report is the last step of the queued run"], [4, 5, "RELATES_TO", "both are writing conventions the reducers or the team enforce"], [6, 0, "RELATES_TO", "both describe a lifecycle transition"]],
};
const DATA = SIZE === "small" ? SMALL : LARGE;

// ---- 1. the vault ----
const { vault } = await control("/vaults", { method: "POST", body: JSON.stringify({ name: NAME }) });
console.log(`vault "${vault.name}" ${vault.id}`);

// ---- 2. notes ----
const noteIds = [];
for (const [title, moc, noteType, status, content] of DATA.notes) {
  const created = await gql(`mutation($name: String!, $parent: String!) { KnowledgeNote { createDocument(name: $name, parentIdOrSlug: $parent) { id } } }`, { name: slug(title), parent: vault.id });
  const id = created.KnowledgeNote.createDocument.id;
  const t = now();
  const actions = [
    act("SET_TITLE", { title, updatedAt: t }),
    act("SET_DESCRIPTION", { description: content.length <= 200 ? content : content.slice(0, 197) + "…", updatedAt: t }),
    act("SET_NOTE_TYPE", { noteType: noteType.toUpperCase().replace("-", "_"), updatedAt: t }), // the v2 reducer's enum is upper case
    act("SET_CONTENT", { content: `${content}\n\nSeeded for a demo vault; not a real extraction.`, updatedAt: t }),
    act("ADD_TOPIC", { id: randomUUID(), name: moc }),
    act("SET_PROVENANCE", { author: "seed-demo-vault", sourceOrigin: "MANUAL", createdAt: t }),
  ];
  if (status !== "DRAFT") actions.push(act("SUBMIT_FOR_REVIEW", { id: randomUUID(), actor: "seed-demo-vault", timestamp: t }));
  if (status === "CANONICAL") actions.push(act("APPROVE_NOTE", { id: randomUUID(), actor: "demo-reviewer", timestamp: t, comment: "Seeded as canonical." }));
  await execute(id, actions);
  noteIds.push(id);
}
console.log(`${noteIds.length} notes`);

// ---- 3. maps ----
const mocIds = {};
for (const m of DATA.mocs) {
  const created = await gql(`mutation($name: String!, $parent: String!) { Moc { createDocument(name: $name, parentIdOrSlug: $parent) { id } } }`, { name: slug(m.title), parent: vault.id });
  mocIds[m.key] = created.Moc.createDocument.id;
  await execute(mocIds[m.key], [act("CREATE_MOC", { title: m.title, description: m.description, orientation: m.orientation, tier: m.tier, createdAt: now() })]);
}
let edges = 0;
for (const m of DATA.mocs) if (m.parent) { await link(mocIds[m.parent], mocIds[m.key], "CHILD_MOC"); edges++; }
for (const [i, [, moc]] of DATA.notes.entries()) { await link(mocIds[moc], noteIds[i], "CORE_IDEA"); edges++; }
for (const [a, b, type, reason] of DATA.links) { await link(noteIds[a], noteIds[b], type, { reason, confidence: "established" }); edges++; }
console.log(`${Object.keys(mocIds).length} maps, ${edges} links`);

// ---- 4. read one note back: rejected actions are recorded, not thrown ----
const back = await gql(`query($id: String!) { document(idOrSlug: $id) { document { operations(filter: { scopes: ["global"] }) { items { index error action { type } } } } } }`, { id: noteIds[0] });
const rejected = (back.document?.document?.operations?.items ?? []).filter((o) => o.error);
if (rejected.length) console.warn("rejected actions on the first note:", rejected.map((o) => `${o.action?.type}: ${o.error}`).join("; "));

// ---- 5. wait for the graph index ----
const deadline = Date.now() + 90_000;
for (;;) {
  const s = (await gql(`query($d: ID!) { knowledgeGraphStats(driveId: $d) { noteCount mocCount edgeCount } }`, { d: vault.id }, "/graphql/knowledgeGraph")).knowledgeGraphStats;
  if (s.noteCount >= noteIds.length && s.edgeCount >= edges) { console.log(`indexed: ${s.noteCount} notes, ${s.mocCount} maps, ${s.edgeCount} edges`); break; }
  if (Date.now() > deadline) { console.warn(`index still catching up: ${JSON.stringify(s)}`); break; }
  await new Promise((r) => setTimeout(r, 1000));
}
