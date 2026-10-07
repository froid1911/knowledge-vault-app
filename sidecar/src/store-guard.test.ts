import { describe, expect, it } from "vitest";
import { compareStack, TOO_NEW_MESSAGE } from "./store-guard.js";
describe("compareStack", () => {
  it("names the four situations", () => {
    expect(compareStack("6.2.3-dev.44", undefined)).toBe("fresh");
    expect(compareStack("6.2.3-dev.44", "6.2.3-dev.44")).toBe("same");
    expect(compareStack("6.2.3-dev.45", "6.2.3-dev.44")).toBe("upgrade");
    expect(compareStack("6.2.3-dev.44", "6.2.3-dev.45")).toBe("downgrade");
  });
  it("tells the user both versions and what to do", () => {
    expect(TOO_NEW_MESSAGE("6.2.3-dev.45", "6.2.3-dev.44")).toBe("This store was last opened by a newer Knowledge Vault (stack 6.2.3-dev.45) than this one (stack 6.2.3-dev.44). Download the newer version to open it.");
  });
});
