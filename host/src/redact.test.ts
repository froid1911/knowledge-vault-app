import { describe, expect, it } from "vitest";
import { redact } from "./redact.js";

describe("redact", () => {
  it("removes credentials whether or not a keyword names them, and the home folder", () => {
    const lines = [
      "Authorization: Bearer abc.def",
      "model key sk-or-v1-123456",
      "token=eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIweGFiYyJ9.c2lnbmF0dXJl ok",
      "GET /callback?code=8f3a9c&state=x",
      "url ...?sig=deadbeef",
      "password: hunter2",
      "Cookie: session=abc",
      "opened /home/alex/.local/share/kv/vault/reactor",
    ];
    const out = lines.map((l) => redact(l, "/home/alex")).join("\n");
    for (const secret of ["abc.def", "sk-or", "eyJhbGci", "8f3a9c", "deadbeef", "hunter2", "session=abc", "/home/alex"]) expect(out).not.toContain(secret);
    expect(out).toContain("~/.local/share/kv/vault/reactor");
    expect(redact("[sidecar] ready on 4201")).toBe("[sidecar] ready on 4201");
  });
});
