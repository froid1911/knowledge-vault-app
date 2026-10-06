import { expect, test } from "@playwright/test";

// Runs after open-vault.spec.ts on the same fresh store (workers: 1), so "E2E vault" already exists.
test("launcher: full view inside a vault, rename from the ⋯ menu, Settings sections, Workflow Studio reachable, typed delete", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vaults" })).toBeVisible();
  const tile = page.getByRole("button", { name: "Open E2E vault" });
  await expect(tile).toBeVisible();

  // Inside a vault the landing's chrome is gone; the app bar is the only landmark.
  await tile.click();
  await expect(page.getByText("Notes", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Knowledge Vault" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Workflows" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "App" })).toBeVisible();
  await page.getByRole("button", { name: "← Vaults" }).click();

  // Rename from the tile's menu.
  await page.getByRole("button", { name: "More actions for E2E vault" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const name = page.getByLabel("Name");
  await name.fill("E2E vault renamed");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("button", { name: "Open E2E vault renamed" })).toBeVisible();

  // Settings: the sections list, Vaults, Models, Diagnostics.
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("navigation", { name: "Settings sections" })).toBeVisible();
  await expect(page.getByText("E2E vault renamed")).toBeVisible();
  await page.getByRole("button", { name: "Models" }).click();
  await expect(page.getByLabel("Endpoint")).toBeVisible();
  await page.getByRole("button", { name: "Diagnostics" }).click();
  await expect(page.getByText(/Ready on port 4201/)).toBeVisible();
  await expect(page.getByText("http://127.0.0.1:4201/mcp")).toBeVisible();
  await page.getByRole("button", { name: "Appearance" }).click();
  await expect(page.getByLabel(/^Dark/)).toBeChecked();
  await page.getByRole("button", { name: "← Vaults" }).click();

  // Workflow Studio, full view, with the runtime reachable (no "unreachable" notice).
  await page.getByRole("button", { name: "Workflows" }).click();
  await expect(page.getByText("Automations in this drive")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/runtime is unreachable/)).toHaveCount(0);
  await page.getByRole("button", { name: "← Vaults" }).click();

  // Delete needs the name typed; the tile disappears and the first-run form returns.
  await page.getByRole("button", { name: "More actions for E2E vault renamed" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const del = page.getByRole("button", { name: "Delete vault" });
  await expect(del).toBeDisabled();
  await page.getByLabel("Type the vault’s name to confirm").fill("E2E vault renamed");
  await expect(del).toBeEnabled();
  await del.click();
  await expect(page.getByRole("button", { name: "Open E2E vault renamed" })).toHaveCount(0);
  await expect(page.getByText("Create your first vault")).toBeVisible();
});
