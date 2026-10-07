import {
  setDrives,
  setSelectedDrive,
  setSelectedNode,
  useAppModuleById,
  useSelectedDocumentId,
  useSelectedDriveSafe,
  type GraphQLReactorClient,
} from "@powerhousedao/reactor-browser";
import { Suspense, useEffect, useState } from "react";
import { DocumentEditorContainer } from "../components/DocumentEditorContainer.js";
import { AppBar } from "../shell/AppBar.js";
import { PipelineChip } from "../components/PipelineChip.js";
import type { SidecarInfo } from "../sidecar.js";

type Drives = NonNullable<Parameters<typeof setDrives>[0]>;
type DriveDoc = Drives[number];

export type WorkspaceApp = "knowledge-vault" | "workflow-studio";

/**
 * Full view for one drive: a vault (the Knowledge Vault app) or the Workflows
 * drive (Workflow Studio). The app bar is the only shell chrome left on screen.
 */
export function WorkspaceScreen(props: {
  client: GraphQLReactorClient;
  driveId: string;
  appId: WorkspaceApp;
  fallbackTitle?: string;
  onBack: () => void;
  onSettings?: () => void;
  /** A local vault's pipeline chip (spec §4.5): where to send the user for a model, and for the runs. */
  pipeline?: { info: SidecarInfo; onModels: () => void; onRuns: () => void };
}) {
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState(props.fallbackTitle ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    props.client
      .get<DriveDoc>(props.driveId)
      .then((drive) => {
        if (cancelled) return;
        // The GraphQL read carries no header.meta, and meta.preferredEditor is how the app
        // module is chosen; a missing pointer is healed with this screen's app (the server's wins).
        const meta = { preferredEditor: props.appId, ...(drive.header.meta ?? {}) };
        const withMeta = { ...drive, header: { ...drive.header, meta } } as DriveDoc;
        const stateName = (drive.state as { global?: { name?: string } } | undefined)?.global?.name;
        setTitle(stateName || drive.header.name || props.fallbackTitle || "");
        setDrives([withMeta]);
        setSelectedDrive(withMeta); // the object: a string argument is taken as a slug
        setReady(true);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      setSelectedNode(undefined);
      setSelectedDrive(undefined);
      setDrives([]);
    };
  }, [props.client, props.driveId, props.appId, props.fallbackTitle]);

  return (
    <div className="kv-vault-screen">
      <AppBar title={title} onBack={props.onBack} onSettings={props.onSettings}>
        {props.pipeline && props.appId === "knowledge-vault" && <PipelineChip info={props.pipeline.info} vaultId={props.driveId} onModels={props.pipeline.onModels} onRuns={props.pipeline.onRuns} />}
      </AppBar>
      {error && <p role="alert" className="kv-error kv-main">Could not open this {props.appId === "workflow-studio" ? "workspace" : "vault"}: {error}</p>}
      {ready ? <AppContainer /> : !error && <p role="status" className="kv-quiet kv-main">Opening…</p>}
    </div>
  );
}

/** Connect's AppContainer, reduced: the drive app renders, with the selected document's editor as its children. */
function AppContainer() {
  const [selectedDrive] = useSelectedDriveSafe();
  const selectedDocumentId = useSelectedDocumentId();
  const app = useAppModuleById(selectedDrive?.header.meta?.preferredEditor);
  if (!selectedDrive) return <p role="status">Opening…</p>;
  if (!app) return <p role="alert">This drive has no app to show it with.</p>;
  const AppComponent = app.Component;
  return (
    <Suspense fallback={<p role="status">Loading the app…</p>}>
      <div className="kv-app">
        <AppComponent>{selectedDocumentId ? <DocumentEditorContainer /> : null}</AppComponent>
      </div>
    </Suspense>
  );
}
