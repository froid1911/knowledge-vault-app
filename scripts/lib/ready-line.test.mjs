import { describe, expect, it } from "vitest";
import { parseReadyLine, parseRestartLine } from "./ready-line.mjs";

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
