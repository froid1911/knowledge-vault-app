// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteVaultDialog } from "./DeleteVaultDialog.js";

afterEach(() => cleanup());

describe("DeleteVaultDialog", () => {
  it("keeps Delete disabled until the vault's name is typed exactly, then confirms", () => {
    const onConfirm = vi.fn();
    render(<DeleteVaultDialog name="Research notes" noteCount={24} busy={false} error={null} onConfirm={onConfirm} onClose={() => {}} />);
    const button = screen.getByRole("button", { name: "Delete vault" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/24 notes, its maps and sources/)).toBeTruthy();
    const input = screen.getByLabelText("Type the vault’s name to confirm");
    fireEvent.change(input, { target: { value: "Research note" } });
    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: " Research notes " } });
    expect(button.disabled).toBe(false);
    fireEvent.submit(input.closest("form")!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
