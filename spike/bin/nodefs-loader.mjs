// THROWAWAY: ESM loader hook that swaps @powerhousedao/pglite-fs for a shim whose
// AtomicNodeFs is PGlite's plain NodeFS (on-disk data dir, no snapshot file).
import { register } from "node:module";
register(new URL("./nodefs-hooks.mjs", import.meta.url));
