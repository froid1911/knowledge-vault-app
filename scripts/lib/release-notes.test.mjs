import { describe, expect, it } from "vitest";
import { releaseNotes, sizeLine } from "./release-notes.mjs";

describe("releaseNotes", () => {
  it("names the versions it was built from — read from the manifests, never typed in", () => {
    const notes = releaseNotes({ app: "0.2.0", stack: "6.2.3-dev.44", vaultPackage: "1.0.54-dev.24", node: "24.21.0" });
    expect(notes).toContain("Knowledge Vault 0.2.0");
    expect(notes).toContain("Powerhouse stack **6.2.3-dev.44**");
    expect(notes).toContain("@powerhousedao/knowledge-note **1.0.54-dev.24**");
    expect(notes).toContain("Node **24.21.0**");
    expect(notes).toMatch(/not signed/i);
    expect(notes).toMatch(/right-click/i);
  });
  it("formats an installer's size in MB", () => {
    expect(sizeLine("Knowledge Vault_0.2.0_amd64.AppImage", 231_456_789)).toBe("| Knowledge Vault_0.2.0_amd64.AppImage | 231 MB |");
  });
});
