// Vitest global setup: every test run gets its own temporary folder, removed when the run ends.
// The tests create scratch folders with mkdtemp(os.tmpdir()); without this they piled up in /tmp
// (3 GB over a day of runs). TMPDIR is set before the workers start, so they inherit it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default function setup() {
  const dir = mkdtempSync(join(tmpdir(), "kv-test-run-"));
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  return () => {
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  };
}
