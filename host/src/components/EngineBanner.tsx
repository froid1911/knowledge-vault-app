import type { EngineHealth } from "../state/use-engine-health.js";

/** Above every screen while the engine does not answer: the supervisor is bringing it back. */
export function EngineBanner({ health }: { health: EngineHealth }) {
  if (health !== "degraded") return null;
  return (
    <div className="kv-engine-banner" role="status">
      <span className="kv-dot" aria-hidden="true" />
      Reconnecting… The engine stopped answering; the app is bringing it back.
    </div>
  );
}
