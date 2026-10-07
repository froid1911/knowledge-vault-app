import { mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeAsset, verifySha256 } from "./node-dist.mjs";

describe("nodeAsset", () => {
  it("names the official archive and the binary inside it per target", () => {
    expect(nodeAsset("24.21.0", "x86_64-unknown-linux-gnu")).toEqual({ archive: "node-v24.21.0-linux-x64.tar.xz", binary: "node-v24.21.0-linux-x64/bin/node", url: "https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz", output: "kv-node-x86_64-unknown-linux-gnu" });
    expect(nodeAsset("24.21.0", "aarch64-apple-darwin").archive).toBe("node-v24.21.0-darwin-arm64.tar.xz");
    expect(nodeAsset("24.21.0", "x86_64-apple-darwin").binary).toBe("node-v24.21.0-darwin-x64/bin/node");
    expect(() => nodeAsset("24.21.0", "riscv64gc-unknown-linux-gnu")).toThrow(/riscv64gc/);
    // Windows: a zip with node.exe at its top, written as Tauri's .exe external binary.
    expect(nodeAsset("24.21.0", "x86_64-pc-windows-msvc")).toEqual({ archive: "node-v24.21.0-win-x64.zip", binary: "node-v24.21.0-win-x64/node.exe", url: "https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip", output: "kv-node-x86_64-pc-windows-msvc.exe" });
    expect(nodeAsset("24.21.0", "x86_64-unknown-linux-gnu").output).toBe("kv-node-x86_64-unknown-linux-gnu");
  });
});
describe("verifySha256", () => {
  it("accepts the pinned hash and rejects a tampered file or a missing pin", () => {
    const d = mkdtempSync(join(tmpdir(), "kv-node-"));
    const f = join(d, "node-v24.21.0-linux-x64.tar.xz");
    writeFileSync(f, "the archive");
    const hash = createHash("sha256").update("the archive").digest("hex");
    expect(() => verifySha256(f, hash)).not.toThrow();
    writeFileSync(f, "tampered");
    expect(() => verifySha256(f, hash)).toThrow(/checksum/);
    expect(() => verifySha256(f, undefined)).toThrow(/no pinned checksum/);
  });
  it("pins a checksum for every target it can bundle", async () => {
    const { NODE_VERSION, NODE_SHA256 } = await import("../node-version.mjs");
    for (const t of ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu", "aarch64-apple-darwin", "x86_64-apple-darwin", "x86_64-pc-windows-msvc"]) {
      expect(NODE_SHA256[nodeAsset(NODE_VERSION, t).archive], t).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
