import { describe, expect, it } from "vitest";
import { protectionEnv } from "./protection-env.mjs";

describe("protectionEnv", () => {
  it("turns the config's local section into the sidecar's protection variables", () => {
    expect(protectionEnv('{"version":1,"local":{"protected":true,"adminAddress":"0xabc"}}')).toEqual({ KV_PROTECTED: "1", KV_ADMIN_ADDRESS: "0xabc" });
  });
  it("yields nothing for an open engine, a missing section, no file or broken JSON", () => {
    expect(protectionEnv('{"local":{"protected":false,"adminAddress":"0xabc"}}')).toEqual({});
    expect(protectionEnv('{"models":{}}')).toEqual({});
    expect(protectionEnv(undefined)).toEqual({});
    expect(protectionEnv("{nope")).toEqual({});
    // protected without an administrator cannot start the engine: treat it as open
    expect(protectionEnv('{"local":{"protected":true}}')).toEqual({});
  });
});
