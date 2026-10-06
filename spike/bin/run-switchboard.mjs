// THROWAWAY probe runner: a second Switchboard that loads the knowledge-note
// package from the main repo (cwd) but keeps its own storage, port and
// safety settings. Workflows are OFF so the pipeline piece cannot act on the
// developer's real server through its stored connection. Auth is OFF.
import { startSwitchboard } from "@powerhousedao/switchboard/server";

const MAIN_REPO = "/home/beast/Documents/Powerhouse/bai-knowledge-note";
const SP = "/home/beast/Documents/Powerhouse/vault-standalone-spike";
const port = Number(process.env.SPIKE_PORT ?? 4101);
const reactorDb = process.env.SPIKE_REACTOR_DB ?? `${SP}/store-a/reactor-storage`;
const readDb = process.env.SPIKE_READ_DB ?? `${SP}/store-a/read-storage`;

// Every key the main repo's .env sets, pinned so dotenv cannot override it.
Object.assign(process.env, {
  PORT: String(port),
  DATABASE_URL: readDb,
  PH_REACTOR_DATABASE_URL: reactorDb,
  PH_SWITCHBOARD_PUBLIC_URL: `http://localhost:${port}`,
  PUBLIC_URL: `http://localhost:${port}`,
  AUTH_ENABLED: "false",
  REQUIRE_AUTHENTICATED_CALLER: "false",
  DEFAULT_PROTECTION: "false",
  DOCUMENT_PERMISSIONS_ENABLED: "false",
  ADMINS: "",
  ADMIN_USERS: "",
  TYPESAFE_API_KEY: "",
  CONVERT_SERVICE_URL: "",
  PH_WORKFLOWS_ENABLED: "0",
  PH_WORKFLOWS_SECRETS_MASTER_KEY: "",
  MCP_ENABLED: "false",
  LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
});
if (process.env.SPIKE_INMEM === "1") process.env.PH_PGLITE_IN_MEMORY = "1";

process.chdir(MAIN_REPO); // powerhouse.config.json + local package (dist/) resolve from here
const t0 = performance.now();
const sb = await startSwitchboard({
  port,
  strictPort: true,
  dev: false,
  mcp: false,
  workflows: { enabled: false },
  remoteDrives: [],
  fatalErrorShutdown: true,
});
console.log(`[spike] switchboard up on ${sb.port} after ${((performance.now() - t0) / 1000).toFixed(1)}s; workflows=${sb.workflowsEnabled} mcp=${sb.mcpEnabled}`);
