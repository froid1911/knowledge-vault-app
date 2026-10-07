import { useEffect, useState } from "react";

export type RemoteReach = "online" | "offline";

/**
 * A remote vault in client mode needs its server (spec §5.5, §9). Probes
 * `<origin>/graphql` with `{ __typename }`; any HTTP answer — a 401 from a
 * protected server included — means reachable. Two failed probes in a row
 * mean offline; one answer means online again.
 */
export function useRemoteHealth(origin: string, pollMs = 15_000, fetchImpl: typeof fetch = fetch): RemoteReach {
  const [reach, setReach] = useState<RemoteReach>("online");
  useEffect(() => {
    let alive = true;
    let failures = 0;
    const handle = setInterval(() => {
      fetchImpl(`${origin}/graphql`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ __typename }" }), signal: AbortSignal.timeout(Math.min(10_000, pollMs * 0.9)) }).then(
        () => {
          failures = 0;
          if (alive) setReach("online");
        },
        () => {
          failures += 1;
          if (alive && failures >= 2) setReach("offline");
        },
      );
    }, pollMs);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [origin, pollMs, fetchImpl]);
  return reach;
}
