import { describe, expect, it } from "vitest";
import { windowsCommandLine } from "./process-identity.js";

describe("windowsCommandLine (recognising the engine's own processes on Windows)", () => {
  it("asks PowerShell for the process's command line by its id", () => {
    const calls: string[][] = [];
    const out = windowsCommandLine(4242, (file, args) => {
      calls.push([file, ...args]);
      return '"C:\\Program Files\\Knowledge Vault\\kv-node.exe" main.js\r\n';
    });
    expect(out).toBe('"C:\\Program Files\\Knowledge Vault\\kv-node.exe" main.js');
    expect(calls[0]![0]).toBe("powershell.exe");
    expect(calls[0]!.join(" ")).toMatch(/Win32_Process.*ProcessId=4242/);
  });
  it("answers nothing for a process that is gone, or when PowerShell fails", () => {
    expect(windowsCommandLine(1, () => "\r\n")).toBeUndefined();
    expect(
      windowsCommandLine(1, () => {
        throw new Error("not found");
      }),
    ).toBeUndefined();
  });
});
