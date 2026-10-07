import type { IncomingMessage, ServerResponse } from "node:http";
import { Server, type Socket } from "node:net";

/**
 * DNS rebinding (Plan 6 review I8): a web page can make its own name resolve to 127.0.0.1 and then
 * talk to the engine — loopback binding alone does not stop it, and the Switchboard checks no Host.
 * The engine's server answers only requests addressed to 127.0.0.1:<port> or localhost:<port>;
 * anything else gets 403 (an upgrade is dropped) before the Switchboard sees it.
 */
export function allowedHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}
function guardHost(server: Server, port: number): void {
  const marked = server as Server & { __kvHostGuard?: boolean };
  if (marked.__kvHostGuard) return;
  marked.__kvHostGuard = true;
  const emit = server.emit.bind(server);
  server.emit = ((event: string | symbol, ...args: unknown[]) => {
    if (event === "request") {
      const [req, res] = args as [IncomingMessage, ServerResponse];
      if (!allowedHost(req.headers.host, port)) {
        res.writeHead(403, { "content-type": "text/plain" }).end("Forbidden: this engine answers only requests addressed to it.");
        return true;
      }
    } else if (event === "upgrade") {
      const [req, socket] = args as [IncomingMessage, Socket];
      if (!allowedHost(req.headers.host, port)) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return true;
      }
    }
    return emit(event, ...args);
  }) as typeof server.emit;
}

/**
 * Spec §4.7: the engine must not listen on the LAN. The Switchboard's HTTP
 * adapter accepts a bind host but nothing supplies one (`startServer` calls
 * `listen(port, tls)`), so the server binds every interface — and open mode
 * makes every anonymous caller the owner. Until upstream exposes a host
 * option (spec §8), the sidecar installs this shim before starting the engine:
 * a `listen()` for exactly the engine's port that names no host is bound to
 * 127.0.0.1. Every other listen (other ports, an explicit host) is untouched.
 */
export function bindLoopbackOnly(port: number, host = "127.0.0.1"): () => void {
  const original = Server.prototype.listen;
  function patched(this: Server, ...args: unknown[]): Server {
    const [first, second] = args;
    const asPort =
      typeof first === "number" ? first : typeof first === "string" && /^\d+$/.test(first) ? Number(first) : undefined;
    const engine = asPort === port || (first && typeof first === "object" && Number((first as { port?: unknown }).port) === port);
    if (engine) guardHost(this, port);
    if (asPort === port) {
      if (typeof second === "string") return original.apply(this, args as never); // a host was named: respect it
      // (port, cb?) or (port, backlog, cb?) or (port, undefined, cb?)
      const rest = typeof second === "function" || second === undefined ? args.slice(typeof second === "function" ? 1 : 2) : args.slice(1);
      return original.apply(this, [first, host, ...rest] as never) as Server;
    }
    if (first && typeof first === "object" && Number((first as { port?: unknown }).port) === port && !(first as { host?: unknown }).host) {
      return original.apply(this, [{ ...(first as object), host }, ...args.slice(1)] as never) as Server;
    }
    return original.apply(this, args as never);
  }
  Server.prototype.listen = patched as typeof Server.prototype.listen;
  return () => {
    Server.prototype.listen = original;
  };
}
