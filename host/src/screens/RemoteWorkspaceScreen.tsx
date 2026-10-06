import { useEffect, useMemo, useState } from "react";
import { createTokenProvider } from "../api/identity.js";
import type { RemoteVault } from "../api/remote.js";
import { declareDesktopHost, type HostIdentity } from "../bootstrap.js";
import { activate } from "../reactor.js";
import type { SidecarInfo } from "../sidecar.js";
import { AppBar } from "../shell/AppBar.js";
import { WorkspaceScreen } from "./WorkspaceScreen.js";

/**
 * A vault on another Switchboard, in client mode (spec §5.5): the mounted app
 * talks to that server with the user's bearer (minted by the engine), and the
 * vault package follows the re-declared host origin. Leaving restores the
 * local engine as the active target.
 */
export function RemoteWorkspaceScreen({ info, vault, identity, onBack, onSettings }: { info: SidecarInfo; vault: RemoteVault; identity: HostIdentity | undefined; onBack: () => void; onSettings?: () => void }) {
  const tokenProvider = useMemo(() => createTokenProvider(info), [info]);
  const [client, setClient] = useState<ReturnType<typeof activate> | null>(null);
  useEffect(() => {
    declareDesktopHost(vault.switchboardUrl, { bearer: tokenProvider, identity });
    setClient(activate({ origin: vault.switchboardUrl, tokenProvider }));
    return () => {
      activate({ origin: info.origin });
      declareDesktopHost(info.origin, { identity });
    };
  }, [info.origin, vault.switchboardUrl, tokenProvider, identity]);
  if (!client) {
    return (
      <div className="kv-vault-screen">
        <AppBar title={vault.name} onBack={onBack} onSettings={onSettings} />
        <p role="status" className="kv-quiet kv-main">Connecting…</p>
      </div>
    );
  }
  return <WorkspaceScreen client={client} driveId={vault.id} appId="knowledge-vault" fallbackTitle={vault.name} onBack={onBack} onSettings={onSettings} />;
}
