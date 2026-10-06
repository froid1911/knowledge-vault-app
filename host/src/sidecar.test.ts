import { describe, expect, it } from "vitest";
import { sidecarOrigins } from "./sidecar.js";

describe("sidecarOrigins", () => {
  it("derives every URL from the ports the sidecar reported, not from defaults", () => {
    expect(sidecarOrigins(4307, 4308)).toEqual({
      origin: "http://127.0.0.1:4307",
      graphqlUrl: "http://127.0.0.1:4307/graphql",
      controlOrigin: "http://127.0.0.1:4308",
    });
  });
});
