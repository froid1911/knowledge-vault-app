export type EngineState =
  | { state: "starting" }
  | { state: "ready" }
  | { state: "exited"; code: number | null }
  | { state: "failed"; detail: string };

const COPY = {
  starting: { label: "Starting the engine…", detail: "Opening your store." },
  ready: { label: "Ready", detail: "" },
} as const;

/** The landing's bottom landmark: the engine's state, the privacy sentence, the version. */
export function StatusStrip({ engine, version }: { engine: EngineState; version?: string }) {
  const exited = engine.state === "exited" || engine.state === "failed";
  const label = engine.state === "exited" ? "The engine stopped" : engine.state === "failed" ? "The app could not reach the engine" : COPY[engine.state].label;
  const detail =
    engine.state === "exited"
      ? `Exit code ${engine.code ?? "unknown"}. Restart the app; if it happens again, start it from a terminal to see the engine's output.`
      : engine.state === "failed"
        ? `${engine.detail}. Restart the app.`
        : COPY[engine.state].detail;
  return (
    <footer className="kv-strip" data-state={engine.state} role={exited ? "alert" : "status"}>
      <div className="kv-strip-inner">
        <span className="kv-dot" aria-hidden="true" />
        <span className="kv-strip-state">{label}</span>
        {detail && <span className="kv-strip-detail">{detail}</span>}
        {!exited && (
          <span className="kv-strip-privacy">
            Everything stays on this computer unless you connect a remote vault, a model provider or a converter.
          </span>
        )}
        {version && <span className="kv-strip-version">{version}</span>}
      </div>
    </footer>
  );
}
