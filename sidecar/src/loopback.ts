import { Server } from "node:net";

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
