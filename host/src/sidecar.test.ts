import { describe, expect, it } from "vitest";
import { sidecarOrigins, statusFromShell } from "./sidecar.js";

describe("sidecarOrigins", () => {
  it("derives every URL from the ports the sidecar reported, not from defaults", () => {
    expect(sidecarOrigins(4307, 4308)).toEqual({
      origin: "http://127.0.0.1:4307",
      graphqlUrl: "http://127.0.0.1:4307/graphql",
      controlOrigin: "http://127.0.0.1:4308",
    });
  });
});

describe("statusFromShell", () => {
  it("maps the shell's three states, deriving the URLs from the reported ports", () => {
    expect(statusFromShell({ state: "starting", ready: null, code: null })).toEqual({ state: "starting" });
    expect(statusFromShell({ state: "ready", ready: { port: 4307, controlPort: 4308, controlToken: "tok" }, code: null })).toEqual({
      state: "ready",
      info: { origin: "http://127.0.0.1:4307", graphqlUrl: "http://127.0.0.1:4307/graphql", controlOrigin: "http://127.0.0.1:4308", controlToken: "tok" },
    });
    expect(statusFromShell({ state: "exited", ready: null, code: 1 })).toEqual({ state: "exited", code: 1 });
    expect(statusFromShell({ state: "exited", ready: null, code: null })).toEqual({ state: "exited", code: null });
  });
});
