import { describe, expect, it } from "vitest";
import { applyEnvironment, engineEnvironment } from "./environment.js";

const matrix = { PORT: "4201", DATABASE_URL: "/data/read-model", NODE_ENV: "production", PH_WORKFLOWS_ENABLED: "1" };

describe("engineEnvironment", () => {
  it("drops everything the engine would read from a developer's shell", () => {
    const inherited = {
      SENTRY_DSN: "https://x@sentry.io/1",
      ENABLE_TRACING: "true",
      PYROSCOPE_SERVER_ADDRESS: "http://pyro:4040",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
      CONVERT_SERVICE_URL: "http://127.0.0.1:5011",
      PH_SOMETHING: "x",
      DATABASE_URL: "postgres://dev:dev@localhost/connect",
      AUTH_ENABLED: "true",
      OPENAI_API_KEY: "sk-live",
      NODE_OPTIONS: "--require ./agent.js",
      PATH: "/usr/bin",
    };
    const env = engineEnvironment(inherited, matrix);
    for (const key of ["SENTRY_DSN", "ENABLE_TRACING", "PYROSCOPE_SERVER_ADDRESS", "OTEL_EXPORTER_OTLP_ENDPOINT", "CONVERT_SERVICE_URL", "PH_SOMETHING", "AUTH_ENABLED", "OPENAI_API_KEY", "NODE_OPTIONS"]) {
      expect(env, key).not.toHaveProperty(key);
    }
    expect(env.DATABASE_URL).toBe("/data/read-model"); // the matrix wins over the inherited value
    expect(env.PATH).toBe("/usr/bin");
  });

  it("keeps what a process needs from the OS, the session, TLS/proxy settings and our own KV_* config", () => {
    const inherited = {
      PATH: "/usr/bin", HOME: "/home/u", LANG: "de_DE.UTF-8", LC_ALL: "C.UTF-8", TZ: "Europe/Berlin", TMPDIR: "/tmp",
      DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus", XDG_RUNTIME_DIR: "/run/user/1000",
      HTTPS_PROXY: "http://proxy:3128", NO_PROXY: "127.0.0.1", SSL_CERT_FILE: "/etc/ssl/ca.pem", NODE_EXTRA_CA_CERTS: "/etc/ssl/corp.pem",
      SystemRoot: "C:\\Windows", APPDATA: "C:\\Users\\u\\AppData\\Roaming", Path: "C:\\Windows\\System32",
      KV_DATA_DIR: "/data", KV_LOG_LEVEL: "debug",
    };
    const env = engineEnvironment(inherited, matrix);
    for (const [key, value] of Object.entries(inherited)) expect(env[key], key).toBe(value);
    expect(env.PORT).toBe("4201");
  });

  it("keeps our KV_* config but never the control token — nothing the engine spawns should inherit it", () => {
    const env = engineEnvironment({ KV_DATA_DIR: "/data", KV_CONTROL_TOKEN: "secret", KV_STDIN_STOP: "1" }, matrix);
    expect(env.KV_DATA_DIR).toBe("/data");
    expect(env.KV_STDIN_STOP).toBe("1");
    expect(env).not.toHaveProperty("KV_CONTROL_TOKEN");
  });

  it("ignores inherited keys with undefined values and never invents keys", () => {
    const env = engineEnvironment({ PATH: undefined, HOME: "/h" }, matrix);
    expect(Object.keys(env).sort()).toEqual(["DATABASE_URL", "HOME", "NODE_ENV", "PH_WORKFLOWS_ENABLED", "PORT"]);
  });
});

describe("applyEnvironment", () => {
  it("leaves the target holding exactly the computed environment", () => {
    const target: Record<string, string | undefined> = { SENTRY_DSN: "x", PATH: "/usr/bin", STALE: "y" };
    applyEnvironment(target, { PATH: "/usr/bin", PORT: "4201" });
    expect(target).toEqual({ PATH: "/usr/bin", PORT: "4201" });
  });
});
