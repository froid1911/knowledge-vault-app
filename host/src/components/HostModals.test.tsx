// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteItemModal, type DeleteItemDeps } from "./HostModals.js";

afterEach(cleanup);

function deps(over: Partial<DeleteItemDeps> = {}): DeleteItemDeps {
  return {
    modal: { type: "deleteItem", id: "doc-1" },
    node: { id: "doc-1", name: "Untitled workflow", kind: "file", parentFolder: "dir-1" },
    driveId: "drive-1",
    close: vi.fn(),
    deleteNode: vi.fn(async () => undefined),
    select: vi.fn(),
    toast: vi.fn(),
    ...over,
  };
}

describe("DeleteItemModal (Connect's deleteItem modal, for apps that call showDeleteNodeModal)", () => {
  it("asks first, then deletes, returns to the parent folder and says so", async () => {
    const d = deps();
    render(<DeleteItemModal deps={d} />);
    expect(screen.getByText("Delete “Untitled workflow”?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(d.close).toHaveBeenCalled();
    await vi.waitFor(() => expect(d.deleteNode).toHaveBeenCalledWith("drive-1", "doc-1"));
    await vi.waitFor(() => expect(d.select).toHaveBeenCalledWith("dir-1"));
    expect(d.toast).toHaveBeenCalledWith("“Untitled workflow” deleted", { type: "success" });
  });

  it("reports a failed delete instead of staying silent", async () => {
    const d = deps({ deleteNode: vi.fn(async () => Promise.reject(new Error("refused"))) });
    render(<DeleteItemModal deps={d} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(d.toast).toHaveBeenCalledWith("Could not delete “Untitled workflow”: refused", { type: "error" }));
    expect(d.select).not.toHaveBeenCalled();
  });

  it("cancels without deleting, and renders nothing for other modals", () => {
    const d = deps();
    const { rerender } = render(<DeleteItemModal deps={d} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(d.close).toHaveBeenCalled();
    expect(d.deleteNode).not.toHaveBeenCalled();
    rerender(<DeleteItemModal deps={deps({ modal: { type: "upgradeDrive" } as never })} />);
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
});
