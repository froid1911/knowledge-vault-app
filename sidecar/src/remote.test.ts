import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { checkRemoteVault, parseRemoteVaultInput, readRemoteVaults, RemoteAccessError, RemoteAuthError, RemoteInputError, RemoteNotFoundError, RemoteTooOldError, writeRemoteVaults } from "./remote.js";
import { writeSettings } from "./settings.js";

describe("parseRemoteVaultInput", () => {
  const origin = "https://switchboard.knowledge-vault.vetra.io";
  it("accepts every form a person pastes", () => {
    expect(parseRemoteVaultInput(`${origin}/graphql`)).toEqual({ origin });
    expect(parseRemoteVaultInput(`${origin}/graphql`, "powerhouse-knowledge")).toEqual({ origin, drive: "powerhouse-knowledge" });
    expect(parseRemoteVaultInput(`${origin}/d/powerhouse-knowledge`)).toEqual({ origin, drive: "powerhouse-knowledge" });
    expect(parseRemoteVaultInput(`${origin}/powerhouse-knowledge`)).toEqual({ origin, drive: "powerhouse-knowledge" });
    expect(parseRemoteVaultInput(`${origin}/`, " c5893e1b-854b-49b1-b8aa-6b133ab87969 ")).toEqual({ origin, drive: "c5893e1b-854b-49b1-b8aa-6b133ab87969" });
    expect(parseRemoteVaultInput("http://127.0.0.1:4001/graphql/r", "x")).toEqual({ origin: "http://127.0.0.1:4001", drive: "x" });
  });
  it("refuses what is not an http(s) URL, and a drive that cannot be decoded", () => {
    expect(() => parseRemoteVaultInput("switchboard.example.com")).toThrow(RemoteInputError);
    expect(() => parseRemoteVaultInput("ftp://x/y")).toThrow(RemoteInputError);
    expect(() => parseRemoteVaultInput(`${origin}/graphql`, "%E0%A4%A")).toThrow(RemoteInputError);
  });
});

describe("remote vault store", () => {
  it("keeps remote vaults in config.json beside other keys and non-remote entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "kv-remote-"));
    writeSettings(dir, { models: { model: "m" } });
    const v = { kind: "remote" as const, id: "c589", slug: "pk", name: "powerhouse-knowledge", switchboardUrl: "https://s.example.com", addedAt: "2026-10-06T00:00:00Z" };
    writeRemoteVaults(dir, [v]);
    expect(readRemoteVaults(dir)).toEqual([v]);
    expect(readRemoteVaults(mkdtempSync(join(tmpdir(), "kv-remote-")))).toEqual([]);
  });
});

describe("checkRemoteVault", () => {
  const fetchFor = (driveStatus: number, canWrite: boolean) =>
    vi.fn(async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      if (url.includes("/d/")) {
        if (!init?.headers?.authorization?.startsWith("Bearer ")) return new Response("{}", { status: 401 });
        return driveStatus === 200 ? new Response(JSON.stringify({ id: "c589", slug: "pk", name: "powerhouse-knowledge" })) : new Response("{}", { status: driveStatus });
      }
      if (init?.body?.includes("__type")) return new Response(JSON.stringify({ data: { __type: { fields: [{ name: "document", args: [{ name: "idOrSlug" }, { name: "identifier" }] }] } } }));
      return new Response(JSON.stringify({ data: { canExecuteOperation: canWrite } }));
    }) as unknown as typeof fetch;
  it("reports the drive and whether the user may write", async () => {
    expect(await checkRemoteVault("https://s.example.com", "pk", "tok", fetchFor(200, true))).toEqual({ id: "c589", slug: "pk", name: "powerhouse-knowledge", switchboardUrl: "https://s.example.com", access: "write" });
    expect((await checkRemoteVault("https://s.example.com", "pk", "tok", fetchFor(200, false))).access).toBe("read");
  });
  it("tells apart a rejected sign-in, a missing grant and an unknown drive", async () => {
    await expect(checkRemoteVault("https://s.example.com", "pk", "tok", fetchFor(401, false))).rejects.toBeInstanceOf(RemoteAuthError);
    await expect(checkRemoteVault("https://s.example.com", "pk", "tok", fetchFor(403, false))).rejects.toBeInstanceOf(RemoteAccessError);
    await expect(checkRemoteVault("https://s.example.com", "pk", "tok", fetchFor(404, false))).rejects.toBeInstanceOf(RemoteNotFoundError);
  });
});

describe("checkRemoteVault — server version", () => {
  const server = (introspection: unknown) =>
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (url.includes("/d/")) return new Response(JSON.stringify({ id: "c589", slug: "pk", name: "pk" }));
      if (init?.body?.includes("__type")) return typeof introspection === "number" ? new Response("{}", { status: introspection }) : new Response(JSON.stringify(introspection));
      return new Response(JSON.stringify({ data: { canExecuteOperation: false } }));
    }) as unknown as typeof fetch;
  it("refuses a server older than dev.35 — its document query has no idOrSlug argument", async () => {
    const old = server({ data: { __type: { fields: [{ name: "document", args: [{ name: "identifier" }] }] } } });
    await expect(checkRemoteVault("https://old.example.com", "pk", "tok", old)).rejects.toBeInstanceOf(RemoteTooOldError);
    await expect(checkRemoteVault("https://old.example.com", "pk", "tok", old)).rejects.toThrow("This vault's server is too old for this app (it needs Powerhouse 6.2.3-dev.35 or newer).");
  });
  it("accepts a current server, and one that does not answer introspection (it cannot be told, so it is not refused)", async () => {
    expect((await checkRemoteVault("https://s.example.com", "pk", "tok", server({ data: { __type: { fields: [{ name: "document", args: [{ name: "idOrSlug" }] }] } } }))).id).toBe("c589");
    expect((await checkRemoteVault("https://s.example.com", "pk", "tok", server({ errors: [{ message: "introspection is disabled" }] }))).id).toBe("c589");
    expect((await checkRemoteVault("https://s.example.com", "pk", "tok", server(500))).id).toBe("c589");
  });
});
