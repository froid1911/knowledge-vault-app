import { mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeAsset, verifySha256 } from "./node-dist.mjs";

describe("nodeAsset", () => {
  it("names the official archive and the binary inside it per target", () => {
    expect(nodeAsset("24.21.0", "x86_64-unknown-linux-gnu")).toEqual({ archive: "node-v24.21.0-linux-x64.tar.xz", binary: "node-v24.21.0-linux-x64/bin/node", url: "https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz", shasums: "https://nodejs.org/dist/v24.21.0/SHASUMS256.txt" });
    expect(nodeAsset("24.21.0", "aarch64-apple-darwin").archive).toBe("node-v24.21.0-darwin-arm64.tar.xz");
    expect(nodeAsset("24.21.0", "x86_64-apple-darwin").binary).toBe("node-v24.21.0-darwin-x64/bin/node");
    expect(() => nodeAsset("24.21.0", "riscv64gc-unknown-linux-gnu")).toThrow(/riscv64gc/);
  });
});
describe("verifySha256", () => {
  it("accepts the listed hash and rejects a tampered file or a missing entry", () => {
    const d = mkdtempSync(join(tmpdir(), "kv-node-"));
    const f = join(d, "node-v24.21.0-linux-x64.tar.xz");
    writeFileSync(f, "the archive");
    const hash = createHash("sha256").update("the archive").digest("hex");
    const sums = `aaaa  other.tar.xz\n${hash}  node-v24.21.0-linux-x64.tar.xz\n`;
    expect(() => verifySha256(f, sums)).not.toThrow();
    writeFileSync(f, "tampered");
    expect(() => verifySha256(f, sums)).toThrow(/checksum/);
    expect(() => verifySha256(f, "aaaa  other.tar.xz\n")).toThrow(/not listed/);
  });
});
