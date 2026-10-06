import { useEditorModuleById, useEditorModulesForDocumentType, useSelectedDocument } from "@powerhousedao/reactor-browser";
import { Suspense } from "react";

/** Connect's DocumentEditor, reduced to module selection; the editors render their own DocumentToolbar. */
export function DocumentEditorContainer() {
  const [document] = useSelectedDocument();
  const preferred = useEditorModuleById(document.header.meta?.preferredEditor);
  const byType = useEditorModulesForDocumentType(document.header.documentType);
  const editor = preferred ?? byType?.[0];
  if (!editor) return <p role="alert">No editor is installed for {document.header.documentType}.</p>;
  const Editor = editor.Component;
  return (
    <div id="document-editor-container" className="flex-1" data-document-type={document.header.documentType}>
      <Suspense fallback={<p role="status">Loading…</p>}>
        <Editor key={document.header.id} document={document} />
      </Suspense>
    </div>
  );
}
