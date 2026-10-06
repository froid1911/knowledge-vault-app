import { describe, expect, it } from "vitest";
import { parseRoute, routeHash } from "./router.js";

describe("routes", () => {
  it("parses every screen and round-trips through the hash", () => {
    const routes = [
      { name: "vaults" }, { name: "vaults", newVault: true }, { name: "vault", id: "a b/c" }, { name: "workflows" }, { name: "settings", section: "models" },
    ] as const;
    for (const r of routes) expect(parseRoute(routeHash(r))).toEqual(r);
  });
  it("lands on the vaults for an empty, unknown or malformed hash, and on the Vaults section for an unknown settings section", () => {
    expect(parseRoute("")).toEqual({ name: "vaults" });
    expect(parseRoute("#/nowhere/at/all")).toEqual({ name: "vaults" });
    expect(parseRoute("#/vault/")).toEqual({ name: "vaults" });
    expect(parseRoute("#/settings")).toEqual({ name: "settings", section: "vaults" });
    expect(parseRoute("#/settings/bogus")).toEqual({ name: "settings", section: "vaults" });
  });
});
