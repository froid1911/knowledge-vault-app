// THROWAWAY: serve the static Connect build with SPA fallback (what nginx does in the Docker image).
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
const root = process.argv[2] ?? "/home/beast/Documents/Powerhouse/vault-standalone-spike/connect-dist/dist";
const port = Number(process.argv[3] ?? 3101);
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".data": "application/octet-stream", ".map": "application/json", ".woff2": "font/woff2" };
createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  let file = join(root, p);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  res.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
  res.setHeader("cross-origin-opener-policy", "same-origin"); res.setHeader("cross-origin-embedder-policy", "credentialless");
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`[serve-connect] ${root} on http://localhost:${port}`));
