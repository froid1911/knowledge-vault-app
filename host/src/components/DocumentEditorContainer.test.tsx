// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ visible: false, setVisible: vi.fn(), operations: vi.fn() }));
vi.mock("@powerhousedao/reactor-browser", () => ({
  useSelectedDocument: () => [{ header: { id: "doc-1", name: "a-note", documentType: "bai/knowledge-note", revision: { global: 7, local: 0 }, meta: {} }, state: { global: { title: "t" } } }],
  useDocumentById: () => [undefined],
  useEditorModuleById: () => undefined,
  useEditorModulesForDocumentType: () => [{ config: { id: "note-editor" }, Component: ({ document }: { document: { header: { id: string } } }) => <p>Editor for {document.header.id}</p> }],
  useRevisionHistoryVisible: () => state.visible,
  setRevisionHistoryVisible: state.setVisible,
  useDocumentOperations: state.operations,
}));
vi.mock("@powerhousedao/design-system/connect", () => ({
  RevisionHistory: (p: { scope: string; scopes: string[]; operations: unknown[]; onClose: () => void; documentId: string }) => (
    <div>
      <p>History of {p.documentId}: {p.operations.length} operations in {p.scope} of {p.scopes.join(",")}</p>
      <button type="button" onClick={p.onClose}>Close history</button>
    </div>
  ),
}));
import { DocumentEditorContainer } from "./DocumentEditorContainer.js";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("DocumentEditorContainer", () => {
  it("renders the editor, under Connect's container id so the vault's dark overrides apply", () => {
    state.visible = false;
    state.operations.mockReturnValue({ operations: [], isLoading: false, hasNextPage: false, fetchNextPage: vi.fn(), error: undefined });
    const { container } = render(<DocumentEditorContainer />);
    expect(screen.getByText("Editor for doc-1")).toBeTruthy();
    const ctx = container.querySelector("#document-editor-context")!;
    expect(ctx.getAttribute("data-document-type")).toBe("bai/knowledge-note");
    expect(ctx.getAttribute("data-editor")).toBe("note-editor");
  });

  it("shows the operations history when the toolbar's History button turned it on, and closes it", () => {
    state.visible = true;
    state.operations.mockReturnValue({ operations: [{ index: 0 }, { index: 1 }], isLoading: false, hasNextPage: false, fetchNextPage: vi.fn(), error: undefined });
    render(<DocumentEditorContainer />);
    expect(screen.getByText("History of doc-1: 2 operations in global of global,local")).toBeTruthy();
    expect(state.operations).toHaveBeenCalledWith("doc-1", "global", { enabled: true, limit: 500 });
    fireEvent.click(screen.getByRole("button", { name: "Close history" }));
    expect(state.setVisible).toHaveBeenCalledWith(false);
  });
});
