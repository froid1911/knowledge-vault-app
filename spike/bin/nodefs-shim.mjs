import { NodeFS } from "@electric-sql/pglite/nodefs";
export class AtomicNodeFs extends NodeFS { constructor(dir, _opts) { super(dir); } }
