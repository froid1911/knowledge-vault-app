/**
 * Spec §4.2: the engine runs with exactly this environment — the Switchboard
 * matrix from config.ts plus what any process needs from the OS and the
 * user's session — and nothing else. A developer's exported SENTRY_DSN, a
 * PH_* or DATABASE_URL from another project, an OPENAI_API_KEY or a
 * NODE_OPTIONS preload must never reach the engine, so inheritance is an
 * allowlist, not a denylist that is complete only until the next Switchboard
 * release reads a new variable.
 */
type Env = Record<string, string | undefined>;

const KEEP = new Set([
  // process basics
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LANGUAGE", "TZ", "TMPDIR", "TEMP", "TMP", "TERM", "COLORTERM",
  // the user's session — the sidecar opens the system browser for sign-in (Plan 1)
  "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "XDG_SESSION_TYPE",
  "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_DIRS", "XDG_CONFIG_DIRS", "XDG_CURRENT_DESKTOP", "BROWSER",
  // TLS and proxies — corporate networks still need to reach model providers and remote vaults
  "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  // Windows
  "SystemRoot", "SYSTEMROOT", "SystemDrive", "windir", "WINDIR", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "PROGRAMDATA", "ProgramData", "HOMEDRIVE", "HOMEPATH", "PATHEXT", "COMSPEC", "ComSpec", "NUMBER_OF_PROCESSORS",
  "USERNAME", "PROCESSOR_ARCHITECTURE",
  // macOS
  "__CF_USER_TEXT_ENCODING",
]);
const KEEP_PREFIXES = ["LC_", "KV_"];

/** The environment the engine runs with: the allowlisted inheritance, then the matrix (which always wins). */
export function engineEnvironment(inherited: Env, matrix: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(inherited)) {
    if (value === undefined) continue;
    if (KEEP.has(key) || KEEP_PREFIXES.some((prefix) => key.startsWith(prefix))) env[key] = value;
  }
  return { ...env, ...matrix };
}

/** Make `target` (normally `process.env`) hold exactly `env`: delete what is not in it, then set the rest. */
export function applyEnvironment(target: Env, env: Record<string, string>): void {
  for (const key of Object.keys(target)) if (!(key in env)) delete target[key];
  Object.assign(target, env);
}
