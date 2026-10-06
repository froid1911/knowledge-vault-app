// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdentityStatus } from "../api/identity.js";
import type { IdentityApi } from "../state/use-identity.js";
import { IdentitySection } from "./Identity.js";

const info = { origin: "http://127.0.0.1:4301", graphqlUrl: "http://127.0.0.1:4301/graphql", controlOrigin: "http://127.0.0.1:4302", controlToken: "t" };
afterEach(() => cleanup());

describe("IdentitySection", () => {
  it("walks the sign-in: button → waiting with the browser link → signed in as the address → sign out", async () => {
    let status: IdentityStatus = { authenticated: false, appDid: "did:key:z6Mk-app", renownUrl: "https://www.renown.id", pending: null };
    const api: IdentityApi = {
      fetchAuthStatus: vi.fn(async () => status),
      startLogin: vi.fn(async () => { status = { ...status, pending: { url: "https://www.renown.id/#/login?session=abc", startedAt: "2026-10-06T12:00:00Z" } }; return { url: status.pending!.url, alreadyAuthenticated: false }; }),
      cancelLogin: vi.fn(async () => { status = { ...status, pending: null }; }),
      logout: vi.fn(async () => { status = { authenticated: false, appDid: "did:key:z6Mk-app", renownUrl: "https://www.renown.id", pending: null }; }),
    };
    render(<IdentitySection info={info} api={api} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in with Renown" }));
    expect(await screen.findByText("Waiting for the browser…")).toBeTruthy();
    expect((screen.getByRole("link", { name: "open the sign-in page" }) as HTMLAnchorElement).href).toBe("https://www.renown.id/#/login?session=abc");
    // the browser flow completes: the next poll sees the credential
    status = { authenticated: true, address: "0xAbC0000000000000000000000000000000001234", did: "did:pkh:eip155:1:0xabc", appDid: "did:key:z6Mk-app", authenticatedAt: "2026-10-06T12:01:00Z", renownUrl: "https://www.renown.id", pending: null };
    await waitFor(() => expect(screen.getByText("0xAbC0000000000000000000000000000000001234")).toBeTruthy(), { timeout: 4000 });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(api.logout).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Sign in with Renown" })).toBeTruthy();
  });
});
