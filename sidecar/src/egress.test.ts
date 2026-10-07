import { describe, expect, it } from "vitest";
import { privateHostAllow } from "./egress.js";
describe("privateHostAllow — the egress entry a LAN model server needs", () => {
  it("names private IPv4 and IPv6 literals as single-address ranges, and nothing for loopback or public hosts", () => {
    expect(privateHostAllow("http://192.168.1.20:11434/v1")).toBe("192.168.1.20/32");
    expect(privateHostAllow("http://10.0.0.5/v1")).toBe("10.0.0.5/32");
    expect(privateHostAllow("http://172.16.3.4:8080/v1")).toBe("172.16.3.4/32");
    expect(privateHostAllow("http://172.32.0.1/v1")).toBeNull(); // not RFC 1918
    expect(privateHostAllow("http://[fd00::1]:11434/v1")).toBe("fd00::1/128");
    expect(privateHostAllow("http://127.0.0.1:11434/v1")).toBeNull();
    expect(privateHostAllow("http://localhost:11434/v1")).toBeNull();
    expect(privateHostAllow("https://openrouter.ai/api/v1")).toBeNull();
    expect(privateHostAllow("not a url")).toBeNull();
  });
});
