import { describe, expect, it } from "vitest";
import { checkVersions, cargoVersion } from "./versions.mjs";

describe("checkVersions", () => {
  it("passes when the app version agrees everywhere, and names each place that differs", () => {
    expect(checkVersions({ "package.json": "0.2.0", "src-tauri/Cargo.toml": "0.2.0", "src-tauri/tauri.conf.json": "0.2.0" })).toEqual([]);
    expect(checkVersions({ "package.json": "0.2.0", "src-tauri/Cargo.toml": "0.1.0", "src-tauri/tauri.conf.json": "0.2.1" })).toEqual([
      "src-tauri/Cargo.toml says 0.1.0, package.json says 0.2.0",
      "src-tauri/tauri.conf.json says 0.2.1, package.json says 0.2.0",
    ]);
  });
  it("reads the package version from Cargo.toml, not a dependency's", () => {
    expect(cargoVersion('[package]\nname = "x"\nversion = "0.3.0"\n\n[dependencies]\nfoo = { version = "9.9.9" }\n')).toBe("0.3.0");
  });
});
