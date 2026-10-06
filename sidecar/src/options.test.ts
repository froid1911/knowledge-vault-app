import { describe, expect, it } from "vitest";
import { readSidecarConfig } from "./config.js";
import { switchboardOptions } from "./options.js";

const cfg = readSidecarConfig({
  KV_DATA_DIR: "/tmp/Knowledge Vault äö/data",
  KV_PORT: "4301",
  KV_CONTROL_PORT: "4302",
  KV_CONTROL_TOKEN: "t",
});

describe("switchboardOptions", () => {
  it("loads the vault and workflow packages only, with the config file named explicitly", () => {
    const o = switchboardOptions(cfg, "/app/sidecar/powerhouse.config.json");
    expect(o.packages).toEqual(["@powerhousedao/knowledge-note", "@powerhousedao/workflow"]);
    expect(o.disableLocalPackages).toBe(true);
    expect(o.dev).toBe(false);
    expect(o.configFile).toBe("/app/sidecar/powerhouse.config.json");
    expect(o.port).toBe(4301);
    expect(o.strictPort).toBe(true);
    expect(o.mcp).toBe(true);
    expect(o.workflows).toEqual({ enabled: true });
  });
  it("keeps the engine's identity keypair under the data dir's secrets, never beside the code", () => {
    const o = switchboardOptions(cfg, "/app/sidecar/powerhouse.config.json");
    expect(o.identity).toEqual({ keypairPath: "/tmp/Knowledge Vault äö/data/secrets/app.keypair.json" });
  });
});
