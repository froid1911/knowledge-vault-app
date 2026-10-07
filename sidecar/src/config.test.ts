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
      logLevel: "info",
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
    // Open mode is declared to the vault package, with the engine's identity as the anonymous caller's.
    expect(env.KNOWLEDGE_VAULT_OPEN_MODE).toBe("1");
    expect(env.KNOWLEDGE_VAULT_OPEN_MODE_ADDRESS).toBe("local");
    expect(switchboardEnv(readSidecarConfig(base), "wfkey", "did:key:z6MkEngine").KNOWLEDGE_VAULT_OPEN_MODE_ADDRESS).toBe("did:key:z6MkEngine");
  });
  it("sets no exemption in open mode — the reactor refuses one while the floor is off", () => {
    expect("REQUIRE_AUTHENTICATED_CALLER_EXEMPT_PATHS" in switchboardEnv(readSidecarConfig(base), "wfkey")).toBe(false);
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
    // /health is how the sidecar knows the engine is up; under the authenticated-caller floor it would answer 401.
    expect(env.REQUIRE_AUTHENTICATED_CALLER_EXEMPT_PATHS).toBe("/health");
    // Protected mode never declares open mode — the guard then requires a real bearer.
    expect("KNOWLEDGE_VAULT_OPEN_MODE" in env).toBe(false);
    expect("KNOWLEDGE_VAULT_OPEN_MODE_ADDRESS" in env).toBe(false);
  });
  it("refuses protected mode without an admin address", () => {
    expect(() => readSidecarConfig({ ...base, KV_PROTECTED: "1" })).toThrow(/KV_ADMIN_ADDRESS/);
  });
});

describe("switchboardEnv — egress", () => {
  it("allows loopback plus whatever the model endpoint needs", () => {
    expect(switchboardEnv(readSidecarConfig(base), "wfkey", "local", ["192.168.1.20/32"]).PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES).toBe("127.0.0.1/32,::1/128,192.168.1.20/32");
    expect(switchboardEnv(readSidecarConfig(base), "wfkey").PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES).toBe("127.0.0.1/32,::1/128");
  });
});
