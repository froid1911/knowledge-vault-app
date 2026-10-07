import {
  closePHModal,
  deleteNode,
  setSelectedNode,
  useNodeById,
  usePHModal,
  useSelectedDriveId,
  type PHModal,
} from "@powerhousedao/reactor-browser";
import { Dialog } from "../shell/Dialog.js";
import { hostToasts } from "./HostToasts.js";

type NodeInfo = { id: string; name: string; kind: string; parentFolder?: string | null };

export type DeleteItemDeps = {
  modal: PHModal | undefined;
  node: NodeInfo | undefined;
  driveId: string | undefined;
  close: () => void;
  deleteNode: (driveId: string, id: string) => Promise<unknown>;
  select: (id: string | undefined) => void;
  toast: (message: string, options: { type: "success" | "error" }) => void;
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Connect's `deleteItem` modal, which `showDeleteNodeModal()` opens (Workflow Studio's
 * sidebar and connection editor use it): confirm, delete, go to the parent folder, say so.
 */
export function DeleteItemModal({ deps }: { deps: DeleteItemDeps }) {
  const open = deps.modal?.type === "deleteItem";
  if (!open) return null;
  const name = deps.node?.name ?? "this item";
  const what = deps.node?.kind === "folder" ? "folder and everything in it" : "document";
  const onDelete = async () => {
    const id = deps.modal?.type === "deleteItem" ? deps.modal.id : undefined;
    deps.close();
    if (!deps.driveId || !id) return;
    try {
      await deps.deleteNode(deps.driveId, id);
      deps.select(deps.node?.parentFolder ?? undefined);
      deps.toast(`“${name}” deleted`, { type: "success" });
    } catch (e) {
      deps.toast(`Could not delete “${name}”: ${message(e)}`, { type: "error" });
    }
  };
  return (
    <Dialog open title={`Delete “${name}”?`} kind="danger" onClose={deps.close}>
      <p>This deletes the {what}. It cannot be undone.</p>
      <div className="kv-dialog-actions">
        <button type="button" className="kv-button" onClick={deps.close}>Cancel</button>
        <button type="button" className="kv-button kv-button-danger" onClick={() => void onDelete()}>Delete</button>
      </div>
    </Dialog>
  );
}

/** The PH modals the host renders for mounted apps (Connect renders these itself). */
export function HostModals() {
  const modal = usePHModal();
  const id = modal?.type === "deleteItem" ? modal.id : undefined;
  const node = useNodeById(id) as NodeInfo | undefined;
  const driveId = useSelectedDriveId();
  return (
    <DeleteItemModal
      deps={{
        modal,
        node,
        driveId,
        close: closePHModal,
        deleteNode,
        select: (folder) => setSelectedNode(folder),
        toast: hostToasts.toast,
      }}
    />
  );
}
