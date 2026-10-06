import { createServer, type AddressInfo } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { bindLoopbackOnly } from "./loopback.js";

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
const listening = (server: ReturnType<typeof createHttpServer>, ...args: unknown[]): Promise<AddressInfo> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    (server.listen as (...a: unknown[]) => unknown)(...args, () => resolve(server.address() as AddressInfo));
  });

let restore: (() => void) | undefined;
const servers: ReturnType<typeof createHttpServer>[] = [];
afterEach(async () => {
  restore?.();
  restore = undefined;
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
  servers.length = 0;
});

describe("bindLoopbackOnly", () => {
  it("binds a host-less listen on the engine's port to 127.0.0.1 and leaves other ports alone", async () => {
    const engine = await freePort();
    const other = await freePort();
    restore = bindLoopbackOnly(engine);
    const a = createHttpServer();
    servers.push(a);
    expect((await listening(a, engine)).address).toBe("127.0.0.1"); // the Switchboard's form: listen(port, cb)
    const b = createHttpServer();
    servers.push(b);
    expect((await listening(b, other)).address).not.toBe("127.0.0.1"); // the default remains for anything else
  });

  it("respects an explicit host and the options form, and restores the original", async () => {
    const engine = await freePort();
    restore = bindLoopbackOnly(engine);
    const a = createHttpServer();
    servers.push(a);
    expect((await listening(a, engine, "0.0.0.0")).address).toBe("0.0.0.0"); // named: untouched
    await new Promise<void>((r) => a.close(() => r()));
    servers.length = 0;
    const b = createHttpServer();
    servers.push(b);
    expect((await listening(b, { port: engine })).address).toBe("127.0.0.1"); // options form without a host
    await new Promise<void>((r) => b.close(() => r()));
    servers.length = 0;
    restore();
    restore = undefined;
    const c = createHttpServer();
    servers.push(c);
    expect((await listening(c, engine)).address).not.toBe("127.0.0.1"); // original behaviour is back
  });
});
