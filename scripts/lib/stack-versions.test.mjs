import { describe, expect, it } from "vitest";
import { checkPgliteVersion, checkStackVersions } from "./stack-versions.mjs";

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

describe("checkPgliteVersion", () => {
  it("accepts a sidecar pin equal to the Switchboard's own", () => {
    expect(checkPgliteVersion("0.3.15", "0.3.15")).toBeNull();
  });
  it("names a mismatch and a Switchboard without the dependency", () => {
    expect(checkPgliteVersion("0.3.16", "0.3.15")).toBe("sidecar: @electric-sql/pglite is 0.3.16, the Switchboard pins 0.3.15");
    expect(checkPgliteVersion("0.3.15", undefined)).toMatch(/cannot verify/);
  });
});
