import { describe, expect, it } from "vitest";
import { readSidecarConfig } from "./config.js";
import { switchboardOptions } from "./options.js";

const cfg = readSidecarConfig({
  KV_DATA_DIR: "/tmp/Knowledge Vault äö/data",
  KV_PORT: "4301",
  KV_CONTROL_PORT: "4302",
  KV_CONTROL_TOKEN: "t",
});

const PACKAGE_DIRS = [
  "/app/sidecar/node_modules/@powerhousedao/knowledge-note",
  "/app/sidecar/node_modules/@powerhousedao/workflow",
];

describe("switchboardOptions", () => {
  it("loads the vault and workflow packages by directory (never by name from cwd), with the config file named explicitly", () => {
    const o = switchboardOptions(cfg, "/app/sidecar/powerhouse.config.json", PACKAGE_DIRS);
    expect(o.packages).toEqual(PACKAGE_DIRS);
    expect(o.disableLocalPackages).toBe(true);
    expect(o.dev).toBe(false);
    expect(o.configFile).toBe("/app/sidecar/powerhouse.config.json");
    expect(o.port).toBe(4301);
    expect(o.strictPort).toBe(true);
    expect(o.mcp).toBe(true);
    expect(o.workflows).toEqual({ enabled: true });
  });
  it("keeps the engine's identity keypair under the data dir's secrets, never beside the code", () => {
    const o = switchboardOptions(cfg, "/app/sidecar/powerhouse.config.json", PACKAGE_DIRS, "https://www.renown.id");
    expect(o.identity).toEqual({ keypairPath: "/tmp/Knowledge Vault äö/data/secrets/app.keypair.json", baseUrl: "https://www.renown.id" });
  });
  it("signs as the user when protected: the SDK's delegated keypair, required to exist (spec §4.4)", () => {
    const protectedCfg = readSidecarConfig({ KV_DATA_DIR: "/data", KV_PORT: "4301", KV_CONTROL_PORT: "4302", KV_CONTROL_TOKEN: "t", KV_PROTECTED: "1", KV_ADMIN_ADDRESS: "0xabc" });
    const o = switchboardOptions(protectedCfg, "/app/sidecar/powerhouse.config.json", PACKAGE_DIRS, "https://www.renown.id");
    expect(o.identity).toEqual({ keypairPath: "/data/secrets/user.keypair.json", requireExisting: true, baseUrl: "https://www.renown.id" });
  });
});
