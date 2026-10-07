// The Switchboard constructs PGlite with @powerhousedao/pglite-fs's AtomicNodeFs
// (whole database in memory, single-file snapshot). On a desktop that costs
// ~3.7 GB RSS for a 1 GB store; PGlite's plain NodeFS keeps the data on disk
// and measured 829 MB. Same class name so the Switchboard needs no change.
import { NodeFS } from "@electric-sql/pglite/nodefs";
export class AtomicNodeFs extends NodeFS {
  constructor(dir, _options) {
    super(dir);
    // KV_DEBUG_PGLITE=1: which directories get a PGlite, and how often — two instances on
    // one plain data dir do not see each other's tables (the snapshot FS tolerated that).
    if (process.env.KV_DEBUG_PGLITE === "1") console.error(`[pglite-fs] NodeFS on ${dir}`);
  }
}
