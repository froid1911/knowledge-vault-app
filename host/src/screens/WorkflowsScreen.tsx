import type { GraphQLReactorClient } from "@powerhousedao/reactor-browser";
import { useEffect, useState } from "react";
import type { SidecarInfo } from "../sidecar.js";
import { fetchWorkflowsDrive, type DriveRef } from "../vaults.js";
import { AppBar } from "../shell/AppBar.js";
import { WorkspaceScreen } from "./WorkspaceScreen.js";

/** Workflow Studio, full view, on the Workflows drive the engine keeps (created on first use). */
export function WorkflowsScreen({ info, client, onBack, onSettings }: { info: SidecarInfo; client: GraphQLReactorClient; onBack: () => void; onSettings?: () => void }) {
  const [drive, setDrive] = useState<DriveRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchWorkflowsDrive(info)
      .then((d) => alive && setDrive(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [info]);
  if (!drive) {
    return (
      <div className="kv-vault-screen">
        <AppBar title="Workflows" onBack={onBack} onSettings={onSettings} />
        {error ? <p role="alert" className="kv-error kv-main">Could not open Workflow Studio: {error}</p> : <p role="status" className="kv-quiet kv-main">Opening…</p>}
      </div>
    );
  }
  return <WorkspaceScreen client={client} driveId={drive.id} appId="workflow-studio" fallbackTitle="Workflows" engine={info} onBack={onBack} onSettings={onSettings} />;
}
