// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionAssist, KNOWLEDGE_VAULT_CONNECTOR, type ConnectionLike } from "./ConnectionAssist.js";

afterEach(cleanup);

const conn = (global: Record<string, unknown>): ConnectionLike => ({ header: { id: "c1", documentType: "powerhouse/connection" }, state: { global } });
const kv = (over: Record<string, unknown> = {}) => conn({ connectorId: KNOWLEDGE_VAULT_CONNECTOR, config: {}, secretRefs: [], ...over });

describe("ConnectionAssist (Studio's Knowledge Vault connection, filled from this app)", () => {
  it("fills this engine's address by itself when the connection has none", async () => {
    const fill = vi.fn(async () => ({ baseUrl: "http://127.0.0.1:4201", token: null }));
    render(<ConnectionAssist document={kv()} fill={fill} />);
    await vi.waitFor(() => expect(fill).toHaveBeenCalledWith("c1", false));
  });

  it("leaves an address that is set alone", () => {
    const fill = vi.fn();
    render(<ConnectionAssist document={kv({ config: { base_url: "https://vault.example.com" } })} fill={fill} />);
    expect(fill).not.toHaveBeenCalled();
  });

  it("offers the app's sign-in for the token, and says how long it lasts", async () => {
    const fill = vi.fn(async () => ({ baseUrl: "x", token: { kind: "minted" as const, expiresAt: "2027-01-05T10:00:00.000Z" } }));
    render(<ConnectionAssist document={kv({ config: { base_url: "x" } })} fill={fill} />);
    fireEvent.click(screen.getByRole("button", { name: "Use my sign-in" }));
    await vi.waitFor(() => expect(fill).toHaveBeenCalledWith("c1", true));
    expect((await screen.findByRole("status")).textContent).toMatch(/Access token added from your sign-in.*valid until/);
  });

  it("says when the engine is open and no real token is needed", async () => {
    const fill = vi.fn(async () => ({ baseUrl: "x", token: { kind: "open" as const, expiresAt: null } }));
    render(<ConnectionAssist document={kv({ config: { base_url: "x" } })} fill={fill} />);
    fireEvent.click(screen.getByRole("button", { name: "Use my sign-in" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/open/);
  });

  it("shows a refusal, and stays out of the way once a token is set or for other services", async () => {
    const fill = vi.fn(async () => Promise.reject(new Error("Sign in first — on a protected engine this runs as you.")));
    const { rerender } = render(<ConnectionAssist document={kv({ config: { base_url: "x" } })} fill={fill} />);
    fireEvent.click(screen.getByRole("button", { name: "Use my sign-in" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Sign in first");
    rerender(<ConnectionAssist document={kv({ config: { base_url: "x" }, secretRefs: [{ id: "s", ref: "r", name: "token" }] })} fill={fill} />);
    expect(screen.queryByRole("button", { name: "Use my sign-in" })).toBeNull();
    rerender(<ConnectionAssist document={conn({ connectorId: "@acme/piece-mail#mail", config: {}, secretRefs: [] })} fill={fill} />);
    expect(screen.queryByRole("button", { name: "Use my sign-in" })).toBeNull();
  });
});
