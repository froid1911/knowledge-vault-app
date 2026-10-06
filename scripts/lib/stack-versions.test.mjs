import { describe, expect, it } from "vitest";
import { checkStackVersions } from "./stack-versions.mjs";

describe("checkStackVersions", () => {
  it("accepts a workspace where every stack package is pinned to the expected version", () => {
    const out = checkStackVersions(
      [
        { name: "sidecar", deps: { "@powerhousedao/switchboard": "6.2.3-dev.44", "document-model": "6.2.3-dev.44" } },
        { name: "host", deps: { "@powerhousedao/reactor-browser": "6.2.3-dev.44", react: "19.2.6" } },
      ],
      "6.2.3-dev.44",
    );
    expect(out).toEqual([]);
  });

  it("ignores the file-linked vault package and document-engineering", () => {
    const out = checkStackVersions(
      [{ name: "host", deps: { "@powerhousedao/knowledge-note": "file:../../bai-knowledge-note", "@powerhousedao/document-engineering": "1.40.5" } }],
      "6.2.3-dev.44",
    );
    expect(out).toEqual([]);
  });

  it("names every mismatch with its workspace and package", () => {
    const out = checkStackVersions(
      [{ name: "sidecar", deps: { "@powerhousedao/switchboard": "6.2.3-dev.43" } }],
      "6.2.3-dev.44",
    );
    expect(out).toEqual(["sidecar: @powerhousedao/switchboard is 6.2.3-dev.43, expected 6.2.3-dev.44"]);
  });
});
