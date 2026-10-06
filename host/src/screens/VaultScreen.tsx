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

type Drives = NonNullable<Parameters<typeof setDrives>[0]>;
type DriveDoc = Drives[number];

export function VaultScreen(props: { client: GraphQLReactorClient; driveId: string; title: string; onBack: () => void }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    props.client
      .get<DriveDoc>(props.driveId)
      .then((drive) => {
        if (cancelled) return;
        // The GraphQL read carries no header.meta, and meta.preferredEditor is how
        // the app module is chosen. This screen only opens vault drives, so a
        // missing pointer is healed with the vault app's id (the server's wins).
        const meta = { preferredEditor: "knowledge-vault", ...(drive.header.meta ?? {}) };
        const withMeta = { ...drive, header: { ...drive.header, meta } } as DriveDoc;
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
  }, [props.client, props.driveId]);

  return (
    <div className="kv-vault-screen">
      <nav className="kv-appbar">
        <button type="button" onClick={props.onBack}>← Vaults</button>
        <span className="kv-appbar-title">{props.title}</span>
      </nav>
      {error && <p role="alert">Could not open this vault: {error}</p>}
      {ready ? <AppContainer /> : !error && <p role="status">Opening…</p>}
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
    <Suspense fallback={<p role="status">Loading the vault…</p>}>
      <div className="kv-app">
        <AppComponent>{selectedDocumentId ? <DocumentEditorContainer /> : null}</AppComponent>
      </div>
    </Suspense>
  );
}
