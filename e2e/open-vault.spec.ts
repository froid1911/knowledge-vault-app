import { expect, test } from "@playwright/test";

test("create a vault on the landing and open the Knowledge Vault app against the local engine", async ({ page }) => {
  const foreign: string[] = [];
  page.on("request", (r) => { if (/localhost:4001|localhost:3001|127\.0\.0\.1:4001|127\.0\.0\.1:3001/.test(r.url())) foreign.push(r.url()); });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vaults" })).toBeVisible();
  await page.getByLabel("Name").fill("E2E vault");
  await page.getByRole("button", { name: "Create vault" }).click();

  // The vault app (from @powerhousedao/knowledge-note) renders its sidebar.
  await expect(page.getByText("Notes", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Graph", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Sign in to open this vault")).toHaveCount(0); // open mode: no gate

  await page.getByRole("button", { name: "← Vaults" }).click();
  await expect(page.getByRole("button", { name: /E2E vault/ })).toBeVisible();
  expect(foreign, "no request may reach a developer's Vetra ports").toEqual([]);
});
