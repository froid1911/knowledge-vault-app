// The Switchboard constructs PGlite with @powerhousedao/pglite-fs's AtomicNodeFs
// (whole database in memory, single-file snapshot). On a desktop that costs
// ~3.7 GB RSS for a 1 GB store; PGlite's plain NodeFS keeps the data on disk
// and measured 829 MB. Same class name so the Switchboard needs no change.
import { NodeFS } from "@electric-sql/pglite/nodefs";
export class AtomicNodeFs extends NodeFS {
  constructor(dir, _options) {
    super(dir);
  }
}
