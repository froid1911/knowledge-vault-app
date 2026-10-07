import { describe, expect, it } from "vitest";
import { parseFatalLine, parseReadyLine, parseRestartLine, parseShutdownLine } from "./ready-line.mjs";

describe("parseReadyLine", () => {
  it("parses the sidecar's readiness line", () => {
    expect(parseReadyLine('{"event":"ready","port":4201,"controlPort":4202}')).toEqual({ port: 4201, controlPort: 4202 });
  });
  it("ignores Switchboard logs, warnings and other JSON", () => {
    expect(parseReadyLine("[15:23:40] [switchboard] Registered /graphql")).toBeNull();
    expect(parseReadyLine("(node:1) [DEP0205] DeprecationWarning: module.register()")).toBeNull();
    expect(parseReadyLine('{"event":"other"}')).toBeNull();
    expect(parseReadyLine("")).toBeNull();
  });
});

describe("parseRestartLine", () => {
  it("recognises the engine's restart request and nothing else", () => {
    expect(parseRestartLine('{"event":"restart","reason":"protection"}')).toEqual({ reason: "protection" });
    expect(parseRestartLine('{"event":"ready","port":4201,"controlPort":4202}')).toBeNull();
    expect(parseRestartLine("[switchboard] restart")).toBeNull();
  });
});

describe("fatal and shutdown lines", () => {
  it("parses them and nothing else", () => {
    expect(parseFatalLine('{"event":"fatal","reason":"store-too-new","message":"m"}')).toEqual({ reason: "store-too-new", message: "m" });
    expect(parseFatalLine('{"event":"ready","port":1,"controlPort":2}')).toBeNull();
    expect(parseShutdownLine('{"event":"shutdown"}')).toBe(true);
    expect(parseShutdownLine("[sidecar] shutting down")).toBe(false);
  });
});
