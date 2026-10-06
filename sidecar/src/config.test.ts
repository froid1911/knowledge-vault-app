import { describe, expect, it } from "vitest";
import { readSidecarConfig, switchboardEnv } from "./config.js";

const base = {
  KV_DATA_DIR: "/tmp/Knowledge Vault äö/data",
  KV_PORT: "4301",
  KV_CONTROL_PORT: "4302",
  KV_CONTROL_TOKEN: "t0k3n",
  KV_HOST_ORIGIN: "http://127.0.0.1:4300",
  KV_APP_VERSION: "0.1.0",
};

describe("readSidecarConfig", () => {
  it("reads the shell's variables and defaults protection to off", () => {
    const cfg = readSidecarConfig(base);
    expect(cfg).toEqual({
      dataDir: "/tmp/Knowledge Vault äö/data",
      port: 4301,
      controlPort: 4302,
      controlToken: "t0k3n",
      hostOrigin: "http://127.0.0.1:4300",
      protected: false,
      adminAddress: undefined,
      appVersion: "0.1.0",
    });
  });
  it("refuses to start without a data dir or token", () => {
    expect(() => readSidecarConfig({ ...base, KV_DATA_DIR: "" })).toThrow(/KV_DATA_DIR/);
    expect(() => readSidecarConfig({ ...base, KV_CONTROL_TOKEN: undefined })).toThrow(/KV_CONTROL_TOKEN/);
  });
});

describe("switchboardEnv", () => {
  it("builds the open-mode environment on the data dir, with telemetry unset", () => {
    const env = switchboardEnv(readSidecarConfig(base), "wfkey");
    expect(env.PORT).toBe("4301");
    expect(env.PH_REACTOR_DATABASE_URL).toBe("/tmp/Knowledge Vault äö/data/reactor");
    expect(env.DATABASE_URL).toBe("/tmp/Knowledge Vault äö/data/read-model");
    expect(env.PH_SWITCHBOARD_PUBLIC_URL).toBe("http://127.0.0.1:4301");
    expect(env.PUBLIC_URL).toBe("http://127.0.0.1:4301");
    expect(env.AUTH_ENABLED).toBe("false");
    expect(env.REQUIRE_AUTHENTICATED_CALLER).toBe("false");
    expect(env.DEFAULT_PROTECTION).toBe("false");
    expect(env.DOCUMENT_PERMISSIONS_ENABLED).toBe("false");
    expect(env.ADMINS).toBe("");
    expect(env.PH_WORKFLOWS_ENABLED).toBe("1");
    expect(env.PH_WORKFLOWS_SECRETS_MASTER_KEY).toBe("wfkey");
    expect(env.PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES).toBe("127.0.0.1/32,::1/128");
    expect(env.SWITCHBOARD_APP_NAME).toBe("desktop-knowledge-vault");
    expect(env.MCP_ENABLED).toBe("true");
    for (const k of ["SENTRY_DSN", "ENABLE_TRACING", "PYROSCOPE_SERVER_ADDRESS", "CONVERT_SERVICE_URL"]) {
      expect(k in env).toBe(false);
    }
  });
  it("turns the four auth flags on with the admin address in protected mode", () => {
    const env = switchboardEnv(
      readSidecarConfig({ ...base, KV_PROTECTED: "1", KV_ADMIN_ADDRESS: "0xabc" }),
      "wfkey",
    );
    expect(env.AUTH_ENABLED).toBe("true");
    expect(env.REQUIRE_AUTHENTICATED_CALLER).toBe("true");
    expect(env.DEFAULT_PROTECTION).toBe("true");
    expect(env.DOCUMENT_PERMISSIONS_ENABLED).toBe("true");
    expect(env.ADMINS).toBe("0xabc");
  });
  it("refuses protected mode without an admin address", () => {
    expect(() => readSidecarConfig({ ...base, KV_PROTECTED: "1" })).toThrow(/KV_ADMIN_ADDRESS/);
  });
});
