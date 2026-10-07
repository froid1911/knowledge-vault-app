import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { foreignNative, prune } from "./prune.mjs";

const FILES = [
  "onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node",
  "onnxruntime-node/bin/napi-v6/linux/arm64/onnxruntime_binding.node",
  "onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node",
  "onnxruntime-node/bin/napi-v6/darwin/x64/onnxruntime_binding.node",
  "onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime_binding.node",
  "@img/sharp-linux-x64/lib/sharp.node",
  "@img/sharp-linuxmusl-x64/lib/sharp.node",
  "@img/sharp-darwin-arm64/lib/sharp.node",
  "@img/sharp-darwin-x64/lib/sharp.node",
  "@img/colour/index.js",
  "@napi-rs/canvas/index.js",
  "@napi-rs/canvas-linux-x64-gnu/skia.node",
  "@napi-rs/canvas-darwin-arm64/skia.node",
  "@napi-rs/canvas-win32-x64-msvc/skia.node",
  "viem/_esm/actions/test/dropTransaction.js",
  "pkg/docs/index.js",
  "pkg/index.js",
  "pkg/index.js.map",
  "pkg/index.d.ts",
  "pkg/index.d.mts",
  "pkg/LICENSE",
  "pkg/README.md",
  "@datadog/pprof/prebuilds/linux-x64/dd_pprof.node.abi137.node",
  "@datadog/pprof/prebuilds/linux-x64/dd_pprof.musl.node.abi137.node",
  "@datadog/pprof/prebuilds/linux-arm64/dd_pprof.node.abi137.node",
  "@datadog/pprof/prebuilds/darwin-arm64/dd_pprof.node.abi137.node",
  "@datadog/pprof/prebuilds/win32-x64/dd_pprof.node.abi137.node",
  "@datadog/pprof/out/src/index.js",
  "utf-8-validate/prebuilds/darwin-x64+arm64/utf-8-validate.node",
  "utf-8-validate/prebuilds/linux-x64/utf-8-validate.node",
  "some-lib/prebuilds/README.txt",
  "some-lib/prebuilds/generic/thing.js",
];
function tree() {
  const nm = join(mkdtempSync(join(tmpdir(), "kv-prune-")), "node_modules");
  for (const f of FILES) {
    mkdirSync(dirname(join(nm, f)), { recursive: true });
    writeFileSync(join(nm, f), "x");
  }
  return nm;
}
const has = (nm, f) => existsSync(join(nm, f));

describe("prune", () => {
  it("keeps this platform's natives and every code directory, whatever its name (never prune by directory name)", () => {
    const nm = tree();
    const freed = prune(nm, "x86_64-unknown-linux-gnu");
    expect(freed).toBeGreaterThan(0);
    for (const f of ["onnxruntime-node/bin/napi-v6/linux/x64/onnxruntime_binding.node", "@img/sharp-linux-x64/lib/sharp.node", "@img/colour/index.js", "@napi-rs/canvas/index.js", "@napi-rs/canvas-linux-x64-gnu/skia.node", "viem/_esm/actions/test/dropTransaction.js", "pkg/docs/index.js", "pkg/index.js", "pkg/LICENSE", "pkg/README.md"]) expect(has(nm, f), f).toBe(true);
    for (const f of ["onnxruntime-node/bin/napi-v6/linux/arm64", "onnxruntime-node/bin/napi-v6/darwin", "onnxruntime-node/bin/napi-v6/win32", "@img/sharp-linuxmusl-x64", "@img/sharp-darwin-arm64", "@napi-rs/canvas-darwin-arm64", "@napi-rs/canvas-win32-x64-msvc", "pkg/index.js.map", "pkg/index.d.ts", "pkg/index.d.mts"]) expect(has(nm, f), f).toBe(false);
  });
  it("keeps the macOS arm64 natives for that target, and nothing for Linux or Windows", () => {
    const nm = tree();
    prune(nm, "aarch64-apple-darwin");
    expect(has(nm, "onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node")).toBe(true);
    expect(has(nm, "@img/sharp-darwin-arm64/lib/sharp.node")).toBe(true);
    expect(has(nm, "@napi-rs/canvas-darwin-arm64/skia.node")).toBe(true);
    for (const f of ["onnxruntime-node/bin/napi-v6/darwin/x64", "onnxruntime-node/bin/napi-v6/linux", "@img/sharp-linux-x64", "@img/sharp-darwin-x64", "@napi-rs/canvas-linux-x64-gnu"]) expect(has(nm, f), f).toBe(false);
  });
  it("keeps the Windows x64 natives for that target, whether named win32 or windows, and drops the others", () => {
    const t = "x86_64-pc-windows-msvc";
    expect(foreignNative("@img/sharp-win32-x64", { os: "win32", cpu: "x64", libc: null })).toBe(false);
    for (const name of ["@img/sharp-win32-x64", "@napi-rs/canvas-win32-x64-msvc", "docling.rs-win32-x64-msvc", "@oxfmt/binding-windows-x64"]) expect(foreignNative(name, { os: "win32", cpu: "x64", libc: null }), name).toBe(false);
    for (const name of ["@img/sharp-linux-x64", "@img/sharp-darwin-arm64", "@napi-rs/canvas-win32-arm64-msvc", "lightningcss-linux-x64-musl"]) expect(foreignNative(name, { os: "win32", cpu: "x64", libc: null }), name).toBe(true);
    expect(() => prune(tree(), t)).not.toThrow();
  });
  it("refuses a target it does not know", () => {
    expect(() => prune(tree(), "sparc-sun-solaris")).toThrow(/sparc/);
  });
  it("prunes prebuilds/<os>-<cpu> folders (the prebuildify layout) for other targets, and musl builds for a glibc target", () => {
    const nm = tree();
    prune(nm, "x86_64-unknown-linux-gnu");
    expect(has(nm, "@datadog/pprof/prebuilds/linux-x64/dd_pprof.node.abi137.node")).toBe(true);
    expect(has(nm, "@datadog/pprof/out/src/index.js")).toBe(true);
    for (const f of ["@datadog/pprof/prebuilds/linux-x64/dd_pprof.musl.node.abi137.node", "@datadog/pprof/prebuilds/linux-arm64", "@datadog/pprof/prebuilds/darwin-arm64", "@datadog/pprof/prebuilds/win32-x64"]) expect(has(nm, f), f).toBe(false);
    const mac = tree();
    prune(mac, "aarch64-apple-darwin");
    expect(has(mac, "@datadog/pprof/prebuilds/darwin-arm64/dd_pprof.node.abi137.node")).toBe(true);
    expect(has(mac, "@datadog/pprof/prebuilds/linux-x64")).toBe(false);
  });
  it("keeps a universal prebuild that covers the target, and anything in prebuilds/ that is not named <os>-<cpu>", () => {
    const mac = tree();
    prune(mac, "aarch64-apple-darwin");
    expect(has(mac, "utf-8-validate/prebuilds/darwin-x64+arm64/utf-8-validate.node")).toBe(true);
    expect(has(mac, "utf-8-validate/prebuilds/linux-x64")).toBe(false);
    const linux = tree();
    prune(linux, "x86_64-unknown-linux-gnu");
    expect(has(linux, "utf-8-validate/prebuilds/darwin-x64+arm64")).toBe(false);
    expect(has(linux, "some-lib/prebuilds/README.txt")).toBe(true);
    expect(has(linux, "some-lib/prebuilds/generic/thing.js")).toBe(true);
  });
});
