// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdentityStatus } from "../api/identity.js";
import { useIdentity, type IdentityApi } from "../state/use-identity.js";
import { IdentitySection } from "./Identity.js";

/** The app owns one identity hook; the section receives it. A fast poll keeps the test quick. */
function Harness({ api }: { api: IdentityApi }) {
  const identity = useIdentity(info, api, 50);
  return <IdentitySection identity={identity} />;
}

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
    render(<Harness api={api} />);
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

describe("IdentitySection — an expired sign-in", () => {
  it("says so and offers to sign in again", async () => {
    const api: IdentityApi = {
      fetchAuthStatus: vi.fn(async () => ({ authenticated: false, expired: true, address: "0xAbC0000000000000000000000000000000001234", appDid: "did:key:z6Mk-app", renownUrl: "https://www.renown.id", pending: null })),
      startLogin: vi.fn(async () => ({ url: "https://www.renown.id/#/login?session=abc", alreadyAuthenticated: false })),
      cancelLogin: vi.fn(async () => ({})),
      logout: vi.fn(async () => ({})),
    };
    render(<Harness api={api} />);
    expect(await screen.findByText(/Your sign-in expired/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    await waitFor(() => expect(api.startLogin).toHaveBeenCalled());
  });
});
