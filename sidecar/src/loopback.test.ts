import { createServer, type AddressInfo } from "node:net";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
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
    expect((await listening(b, { port: String(engine) })).address).toBe("127.0.0.1"); // options form without a host, port as a string
    await new Promise<void>((r) => b.close(() => r()));
    servers.length = 0;
    restore();
    restore = undefined;
    const c = createHttpServer();
    servers.push(c);
    expect((await listening(c, engine)).address).not.toBe("127.0.0.1"); // original behaviour is back
  });
  it("answers only requests addressed to it on the engine's port — a foreign Host (DNS rebinding) gets 403 and never reaches the handler", async () => {
    const port = await freePort();
    restore = bindLoopbackOnly(port);
    let handled = 0;
    const server = createHttpServer((_req, res) => {
      handled += 1;
      res.end("ok");
    });
    servers.push(server);
    await listening(server, port);
    const get = (host: string) =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest({ host: "127.0.0.1", port, path: "/graphql", headers: { host } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end();
      });
    expect(await get(`127.0.0.1:${port}`)).toBe(200);
    expect(await get(`localhost:${port}`)).toBe(200);
    expect(await get(`evil.example:${port}`)).toBe(403);
    expect(await get(`127.0.0.1:${port + 1}`)).toBe(403);
    expect(handled).toBe(2);
    // a WebSocket upgrade from a foreign Host is dropped
    let upgraded = 0;
    server.on("upgrade", (_req, socket) => {
      upgraded += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => {
      const req = httpRequest({ host: "127.0.0.1", port, path: "/graphql/subscriptions", headers: { host: `evil.example:${port}`, connection: "Upgrade", upgrade: "websocket" } });
      req.on("error", () => resolve());
      req.on("response", () => resolve());
      req.on("upgrade", () => resolve());
      req.end();
    });
    expect(upgraded).toBe(0);
  });
});
