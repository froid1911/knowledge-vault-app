import { useEffect, useState } from "react";
import type { SettingsApi } from "../screens/Settings.js";
import type { SidecarInfo } from "../sidecar.js";
import type { EngineStatus } from "../vaults.js";

export function AboutSection({ info, api }: { info: SidecarInfo; api: SettingsApi }) {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  useEffect(() => {
    let alive = true;
    api.fetchStatus(info).then((s) => alive && setStatus(s)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, info]);
  return (
    <div className="kv-settings-body">
      <p className="kv-settings-lead">Knowledge Vault runs the Powerhouse Knowledge Vault on your own computer: your notes, their graph and the pipeline, with nothing leaving the machine unless you connect something.</p>
      <dl className="kv-facts">
        <dt>App</dt><dd>{status?.appVersion ?? "…"}</dd>
        <dt>Powerhouse stack</dt><dd>{status?.stackVersion ?? "…"}</dd>
        <dt>Vault package</dt><dd>{status?.vaultPackageVersion ?? "…"}</dd>
      </dl>
    </div>
  );
}
