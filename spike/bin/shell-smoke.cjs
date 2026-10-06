// THROWAWAY: headless check of the static Connect build (:3101) against the probe Switchboard (:4101).
const { chromium } = require("/home/beast/Documents/Personal/condo/condo-fusion/node_modules/playwright-core");
const fs = require("node:fs");
const SP = "/home/beast/Documents/Powerhouse/vault-standalone-spike";
const url = process.argv[2] ?? "http://localhost:3101/";
const tag = process.argv[3] ?? "run";
const blockDevServer = process.argv.includes("--block-4001");
const rewriteDevServer = process.argv.includes("--rewrite-4001");
const PROBES = ["Knowledge Vault", "Notes", "Search", "Graph", "Sources", "Pipeline"];
(async () => {
  const exe = ["/home/beast/.cache/ms-playwright/chromium-1234/chrome-linux/chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const hosts = {}; const consoleErrors = new Map(); const failed = [];
  page.on("request", (r) => { try { const h = new URL(r.url()).host; hosts[h] = (hosts[h] ?? 0) + 1; } catch {} });
  const sbCalls = [];
  page.on("response", async (res) => { const u = res.url(); if (/localhost:(4101|4001)/.test(u)) { let op = ""; try { const b = res.request().postData(); if (b) op = (JSON.parse(b).query || "").replace(/\s+/g, " ").slice(0, 90); } catch {} if (sbCalls.length < 40) sbCalls.push(`${res.status()} ${res.request().method()} ${u.replace("http://localhost:", ":")} ${op}`); } });
  page.on("requestfailed", (r) => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 110)}`));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") { const k = m.text().slice(0, 160); consoleErrors.set(k, (consoleErrors.get(k) ?? 0) + 1); } });
  if (blockDevServer) await page.route(/localhost:4001/, (route) => route.abort());
  if (rewriteDevServer) await page.route(/localhost:4001/, (route) => route.continue({ url: route.request().url().replace("localhost:4001", "localhost:4101") }));
  const t0 = Date.now();
  let gotoErr = null;
  try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); } catch (e) { gotoErr = String(e).slice(0, 160); }
  let found = {}; let shot1 = false;
  const thenDrive = process.argv.find((a) => a.startsWith("--then-drive="))?.slice(13);
  if (thenDrive) { await page.waitForTimeout(20000); await page.screenshot({ path: `${SP}/measure/shell-${tag}-home.png` }).catch(() => {});
    const sidebarBtn = page.locator("button").first(); try { await sidebarBtn.click({ timeout: 3000 }); await page.waitForTimeout(1500); } catch {}
    found.sidebarText = ((await page.textContent("body").catch(() => "")) || "").replace(/\s+/g, " ").slice(0, 300);
    await page.goto(thenDrive, { waitUntil: "domcontentloaded", timeout: 30000 }).catch((e) => { found.gotoDriveErr = String(e).slice(0, 120); }); }
  while (Date.now() - t0 < 100000) {
    for (const p of PROBES) if (!found[p]) { try { if ((await page.getByText(p, { exact: false }).count()) > 0) found[p] = Math.round((Date.now() - t0) / 100) / 10; } catch {} }
    if (!shot1 && Date.now() - t0 > 15000) { await page.screenshot({ path: `${SP}/measure/shell-${tag}-15s.png` }).catch(() => {}); shot1 = true; }
    if (Object.keys(found).length >= 3) break;
    await page.waitForTimeout(3000);
  }
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SP}/measure/shell-${tag}-end.png` }).catch(() => {});
  const heapMb = await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576)).catch(() => null);
  const bodyText = (await page.textContent("body").catch(() => ""))?.replace(/\s+/g, " ").slice(0, 500);
  const report = { tag, url, blockDevServer, rewriteDevServer, sbCalls: sbCalls.filter((c, i, a) => a.indexOf(c) === i).slice(0, 25), gotoErr, title: await page.title(), finalUrl: page.url(), found, elapsedS: Math.round((Date.now() - t0) / 1000), heapMb, hosts, consoleErrors: [...consoleErrors.entries()].slice(0, 10), failed: failed.slice(0, 8), bodyText };
  fs.writeFileSync(`${SP}/measure/shell-${tag}.json`, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report));
  await browser.close();
})().catch((e) => { console.error("SMOKE FAILED", String(e).slice(0, 300)); process.exit(1); });
