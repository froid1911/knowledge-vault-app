import { expect, test } from "@playwright/test";

test("create a vault on the landing and open the Knowledge Vault app against the local engine", async ({ page }) => {
  // Spec §2: nothing leaves the machine. Every network request must target one of the three loopback ports.
  const allowed = /^(?:https?|wss?):\/\/127\.0\.0\.1:420\d(?:[/?#]|$)/;
  const foreign: string[] = [];
  page.on("request", (r) => { const u = r.url(); if (/^(?:https?|wss?):/.test(u) && !allowed.test(u)) foreign.push(u); });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vaults" })).toBeVisible();
  // Dark by default, with the vault app's own tokens (spec §5.7): --bai-bg of the Mocha theme is #1e1e2e.
  expect(await page.evaluate(() => document.documentElement.dataset.baiTheme)).toBe("dark");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe("rgb(30, 30, 46)");
  await page.screenshot({ path: "test-results/landing-dark.png" });
  // First run shows the form; with vaults already present (another spec ran first) "New vault" opens it.
  const newVault = page.getByRole("button", { name: "New vault" });
  if (await newVault.isVisible().catch(() => false)) await newVault.click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("E2E vault");
  await page.getByRole("button", { name: "Create vault" }).click();

  // The vault app (from @powerhousedao/knowledge-note) renders its sidebar.
  await expect(page.getByText("Notes", { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Graph", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Sign in to open this vault")).toHaveCount(0); // open mode: no gate

  await page.getByRole("button", { name: "← Vaults" }).click();
  await expect(page.getByRole("button", { name: "Open E2E vault" })).toBeVisible();
  await expect(page.getByText("Ready", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/landing-with-vault.png" });
  expect(foreign, "only the three loopback ports may be contacted").toEqual([]);
});
