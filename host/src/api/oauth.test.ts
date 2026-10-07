import { describe, expect, it, vi } from "vitest";
import { externalSignIn } from "./oauth.js";

const info = { origin: "http://127.0.0.1:4201", graphqlUrl: "http://127.0.0.1:4201/graphql", controlOrigin: "http://127.0.0.1:4202", controlToken: "t" };

describe("externalSignIn", () => {
  it("starts a callback on the engine, opens the provider in the system browser, and waits for the code", async () => {
    let polls = 0;
    const control = vi.fn(async (_i: unknown, path: string) => {
      if (path === "/oauth/start") return { nonce: "n1", callbackUrl: "http://localhost:4202/oauth/callback/n1" };
      polls += 1;
      return polls < 3 ? { pending: true } : { code: "the-code" };
    });
    const open = vi.fn(async () => {});
    const code = await externalSignIn(info, (cb) => `https://openrouter.ai/auth?callback_url=${encodeURIComponent(cb)}`, { control, open, sleep: async () => {} });
    expect(code).toBe("the-code");
    expect(open).toHaveBeenCalledWith("https://openrouter.ai/auth?callback_url=http%3A%2F%2Flocalhost%3A4202%2Foauth%2Fcallback%2Fn1");
    expect(control.mock.calls.filter(([, p]) => p === "/oauth/result/n1")).toHaveLength(3);
  });
  it("gives up after the deadline", async () => {
    let now = 0;
    const control = vi.fn(async (_i: unknown, path: string) => (path === "/oauth/start" ? { nonce: "n2", callbackUrl: "x" } : { pending: true }));
    await expect(externalSignIn(info, () => "u", { control, open: async () => {}, sleep: async () => { now += 60_000; }, now: () => now })).rejects.toThrow(/did not finish/);
  });
});
