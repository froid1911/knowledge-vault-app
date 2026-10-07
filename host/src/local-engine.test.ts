import { describe, expect, it } from "vitest";
import { localHostExtras } from "./local-engine.js";

const info = { origin: "http://127.0.0.1:4201", graphqlUrl: "http://127.0.0.1:4201/graphql", controlOrigin: "http://127.0.0.1:4202", controlToken: "t" };

describe("localHostExtras", () => {
  it("gives a protected engine the user's bearer and an open engine none", () => {
    const provider = async () => "jwt";
    expect(localHostExtras(true, info, provider).bearer).toBe(provider);
    expect(localHostExtras(false, info, provider).bearer).toBeUndefined();
  });
});
