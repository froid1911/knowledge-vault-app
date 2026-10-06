import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readModelKey, readSettings, SettingsError, writeSettings } from "./settings.js";

const dir = () => mkdtempSync(join(tmpdir(), "kv-settings-"));

describe("settings", () => {
  it("starts from defaults and never reports a key it does not have", () => {
    expect(readSettings(dir())).toEqual({
      version: 1,
      models: { endpoint: "https://openrouter.ai/api/v1", model: "", hasKey: false },
      conversion: { mode: "local", remoteUrl: "" },
    });
  });
  it("persists endpoint and model in config.json, the key in secrets/ with mode 0600, and reports only hasKey", () => {
    const d = dir();
    const out = writeSettings(d, { models: { endpoint: "http://127.0.0.1:11434/v1", model: "llama3", apiKey: "sk-secret" } });
    expect(out.models).toEqual({ endpoint: "http://127.0.0.1:11434/v1", model: "llama3", hasKey: true });
    expect(JSON.stringify(readFileSync(join(d, "config.json"), "utf8"))).not.toContain("sk-secret");
    if (process.platform !== "win32") expect(statSync(join(d, "secrets", "llm.key")).mode & 0o777).toBe(0o600);
    expect(readModelKey(d)).toBe("sk-secret");
    expect(readSettings(d).models.hasKey).toBe(true);
  });
  it("keeps the key when the patch omits it and clears it on an empty string", () => {
    const d = dir();
    writeSettings(d, { models: { apiKey: "k1" } });
    writeSettings(d, { models: { model: "gpt" } });
    expect(readModelKey(d)).toBe("k1");
    writeSettings(d, { models: { apiKey: "" } });
    expect(readModelKey(d)).toBeUndefined();
    expect(existsSync(join(d, "secrets", "llm.key"))).toBe(false);
  });
  it("rejects a model endpoint that is not an http(s) URL — a key will be sent there", () => {
    expect(() => writeSettings(dir(), { models: { endpoint: "ftp://x" } })).toThrow(SettingsError);
    expect(() => writeSettings(dir(), { models: { endpoint: "openrouter.ai/api/v1" } })).toThrow(SettingsError);
  });
  it("persists the conversion mode and server, trimming a trailing slash", () => {
    const d = dir();
    const out = writeSettings(d, { conversion: { mode: "remote", remoteUrl: "http://127.0.0.1:5011/" } });
    expect(out.conversion).toEqual({ mode: "remote", remoteUrl: "http://127.0.0.1:5011" });
    expect(writeSettings(d, { conversion: { mode: "off" } }).conversion).toEqual({ mode: "off", remoteUrl: "http://127.0.0.1:5011" });
    expect(readSettings(d).conversion.mode).toBe("off");
  });
  it("refuses another server without a URL, a URL that is not http(s), and an unknown mode", () => {
    expect(() => writeSettings(dir(), { conversion: { mode: "remote" } })).toThrow(SettingsError);
    expect(() => writeSettings(dir(), { conversion: { mode: "remote", remoteUrl: "ftp://x" } })).toThrow(SettingsError);
    expect(() => writeSettings(dir(), { conversion: { mode: "docker" as never } })).toThrow(SettingsError);
  });
  it("preserves keys in config.json it does not own", () => {
    const d = dir();
    writeFileSync(join(d, "config.json"), JSON.stringify({ version: 1, ui: { theme: "dark" }, vaults: [] }));
    writeSettings(d, { models: { model: "x" } });
    const raw = JSON.parse(readFileSync(join(d, "config.json"), "utf8")) as Record<string, unknown>;
    expect(raw.ui).toEqual({ theme: "dark" });
    expect(raw.vaults).toEqual([]);
  });
});
