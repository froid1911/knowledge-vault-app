import { useEffect, useState } from "react";
import type { SidecarInfo } from "../sidecar.js";
import { fetchStatus as realFetchStatus } from "../vaults.js";

export type EngineHealth = "ok" | "degraded";

/**
 * Spec §9: the engine may stop under a running window (a crash the supervisor is
 * restarting). Two consecutive failed `/status` reads mean "degraded" — one is a
 * blip; a single success means "ok" again.
 */
export function useEngineHealth(
  info: SidecarInfo | undefined,
  pollMs = 5000,
  api: { fetchStatus: (info: SidecarInfo) => Promise<unknown> } = { fetchStatus: realFetchStatus },
): EngineHealth {
  const [health, setHealth] = useState<EngineHealth>("ok");
  useEffect(() => {
    if (!info) return;
    let alive = true;
    let failures = 0;
    const handle = setInterval(() => {
      api.fetchStatus(info).then(
        () => {
          failures = 0;
          if (alive) setHealth("ok");
        },
        () => {
          failures += 1;
          if (alive && failures >= 2) setHealth("degraded");
        },
      );
    }, pollMs);
    return () => {
      alive = false;
      clearInterval(handle);
    };
  }, [info, pollMs, api]);
  return health;
}
