import { join } from "node:path";

export type SidecarConfig = {
  dataDir: string;
  port: number;
  controlPort: number;
  controlToken: string;
  hostOrigin: string;
  protected: boolean;
  adminAddress: string | undefined;
  appVersion: string;
  logLevel: string;
};

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const v = env[key];
  if (!v) throw new Error(`${key} is required`);
  return v;
}
function port(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${key} must be a port, got "${raw}"`);
  return n;
}

export function readSidecarConfig(env: Env): SidecarConfig {
  const isProtected = env.KV_PROTECTED === "1";
  const adminAddress = env.KV_ADMIN_ADDRESS || undefined;
  if (isProtected && !adminAddress) throw new Error("KV_ADMIN_ADDRESS is required when KV_PROTECTED=1");
  return {
    dataDir: required(env, "KV_DATA_DIR"),
    port: port(env, "KV_PORT", 4201),
    controlPort: port(env, "KV_CONTROL_PORT", 4202),
    controlToken: required(env, "KV_CONTROL_TOKEN"),
    hostOrigin: env.KV_HOST_ORIGIN || "http://127.0.0.1:4200",
    protected: isProtected,
    adminAddress,
    appVersion: env.KV_APP_VERSION || "dev",
    logLevel: env.KV_LOG_LEVEL || "info",
  };
}

/** Spec §4.2: the environment the Switchboard is started with. Nothing else is inherited. */
export function switchboardEnv(cfg: SidecarConfig, workflowsMasterKey: string): Record<string, string> {
  const origin = `http://127.0.0.1:${cfg.port}`;
  const flag = cfg.protected ? "true" : "false";
  return {
    PORT: String(cfg.port),
    PH_REACTOR_DATABASE_URL: join(cfg.dataDir, "reactor"),
    DATABASE_URL: join(cfg.dataDir, "read-model"),
    PH_SWITCHBOARD_PUBLIC_URL: origin,
    PUBLIC_URL: origin,
    AUTH_ENABLED: flag,
    REQUIRE_AUTHENTICATED_CALLER: flag,
    DEFAULT_PROTECTION: flag,
    DOCUMENT_PERMISSIONS_ENABLED: flag,
    ADMINS: cfg.protected ? (cfg.adminAddress ?? "") : "",
    PH_WORKFLOWS_ENABLED: "1",
    PH_WORKFLOWS_SECRETS_MASTER_KEY: workflowsMasterKey,
    PH_WORKFLOWS_EGRESS_ALLOW_ADDRESSES: "127.0.0.1/32,::1/128",
    SWITCHBOARD_APP_NAME: "desktop-knowledge-vault",
    MCP_ENABLED: "true",
    LOG_LEVEL: cfg.logLevel,
    NODE_ENV: "production",
  };
}
