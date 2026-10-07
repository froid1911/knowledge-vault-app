import { describe, expect, it } from "vitest";
import { compareVersions } from "./version.js";
describe("compareVersions", () => {
  it("orders releases, prereleases and dev builds the semver way", () => {
    expect(compareVersions("6.2.3", "6.2.3")).toBe(0);
    expect(compareVersions("6.2.3", "6.2.3-dev.44")).toBe(1); // a release is newer than its prereleases
    expect(compareVersions("6.2.3-dev.44", "6.2.3-dev.45")).toBe(-1);
    expect(compareVersions("6.2.3-dev.9", "6.2.3-dev.44")).toBe(-1); // numeric, not lexical
    expect(compareVersions("6.10.0", "6.9.9")).toBe(1);
    expect(compareVersions("7.0.0-dev.1", "6.2.3")).toBe(1);
  });
});
