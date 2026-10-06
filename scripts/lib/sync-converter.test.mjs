import { describe, expect, it } from "vitest";
import { diffVendored, selectConverterFiles } from "./sync-converter.mjs";

describe("selectConverterFiles", () => {
  it("vendors the entry, modules and typings, never tests, fixtures or configs", () => {
    const picked = selectConverterFiles([
      "server.ts",
      "server.heartbeat.test.ts",
      "server.nobinding.test.ts",
      "textlayer.mjs",
      "textlayer.d.mts",
      "textlayer.test.ts",
      "fetch-models.mjs",
      "fixtures",
      "fixtures/text.pdf",
      "README.md",
      "SOURCE.json",
    ]);
    expect(picked).toEqual(["fetch-models.mjs", "server.ts", "textlayer.d.mts", "textlayer.mjs"]);
  });
});

describe("diffVendored", () => {
  it("names what is missing, stale and extra", () => {
    const source = new Map([["server.ts", "a"], ["textlayer.mjs", "b"]]);
    const vendored = new Map([["server.ts", "a"], ["textlayer.mjs", "old"], ["gone.mjs", "x"]]);
    expect(diffVendored(source, vendored)).toEqual(["stale: textlayer.mjs", "extra: gone.mjs"]);
    expect(diffVendored(source, new Map([["server.ts", "a"]]))).toEqual(["missing: textlayer.mjs"]);
    expect(diffVendored(source, new Map(source))).toEqual([]);
  });
});
