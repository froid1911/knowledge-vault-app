import { RevisionHistory } from "@powerhousedao/design-system/connect";
import {
  setRevisionHistoryVisible,
  useDocumentById,
  useDocumentOperations,
  useEditorModuleById,
  useEditorModulesForDocumentType,
  useRevisionHistoryVisible,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import { Suspense, useMemo, useState } from "react";

function defaultScope(scopes: readonly string[]): string {
  return scopes.includes("global") ? "global" : (scopes[0] ?? "global");
}

/**
 * Connect's DocumentEditor, reduced: the editor for the selected document, or —
 * when the toolbar's History button turned it on — the revision history panel
 * in its place, fed one scope at a time by useDocumentOperations. The wrapper
 * keeps Connect's `#document-editor-context` id and data attributes, which the
 * vault package's dark-mode overrides key on.
 */
export function DocumentEditorContainer() {
  const [selected] = useSelectedDocument();
  const [live] = useDocumentById(selected.header.id);
  const document = live ?? selected;
  const documentId = document.header.id;
  const documentType = document.header.documentType;
  const preferred = useEditorModuleById(document.header.meta?.preferredEditor);
  const byType = useEditorModulesForDocumentType(documentType);
  const editor = preferred ?? byType?.[0];

  const visible = useRevisionHistoryVisible();
  const scopes = useMemo(() => {
    const keys = Object.keys(document.header.revision ?? {});
    return keys.length > 0 ? keys : ["global"];
  }, [document.header.revision]);
  const [chosenScope, setChosenScope] = useState(() => defaultScope(scopes));
  const scope = scopes.includes(chosenScope) ? chosenScope : defaultScope(scopes);
  const history = useDocumentOperations(documentId, scope, { enabled: visible, limit: 500 });

  if (!editor) return <p role="alert">No editor is installed for {documentType}.</p>;
  const Editor = editor.Component;
  return (
    <div id="document-editor-context" className="relative h-full flex-1" data-editor={editor.config.id} data-document-type={documentType}>
      {visible ? (
        <RevisionHistory
          key={documentId}
          documentTitle={document.header.name ?? ""}
          documentId={documentId}
          operations={history.operations}
          isLoading={history.isLoading}
          hasNextPage={history.hasNextPage}
          onLoadNextPage={history.fetchNextPage}
          error={history.error ?? undefined}
          scopes={scopes}
          scope={scope}
          onScopeChange={setChosenScope}
          onClose={() => setRevisionHistoryVisible(false)}
          documentState={document.state}
        />
      ) : (
        <Suspense fallback={<p role="status">Loading…</p>}>
          <Editor key={documentId} document={document} />
        </Suspense>
      )}
    </div>
  );
}
