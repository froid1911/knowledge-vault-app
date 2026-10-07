import { describe, expect, it } from "vitest";
import { invokeIfTauri } from "./tauri.js";

describe("invokeIfTauri", () => {
  it("answers undefined in a browser, without trying to reach the shell", async () => {
    expect(await invokeIfTauri("open_logs")).toBeUndefined();
  });
});
