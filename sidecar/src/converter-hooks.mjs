// `--import`ed into the conversion helper (and the models fetcher): resolves the
// bare `docling.rs` and `sharp` to the packages installed in app-data
// (`$CONVERTER_MODULES_DIR/<name>`), when they are there. The vendored service
// imports them lazily and runs binding-less otherwise. The binding's own
// platform package is a plain `require` from inside it, so it needs no hook.
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NAMES = new Set(["docling.rs", "sharp"]);

/** The entry file of an installed package, or null when it is not installed. */
export function entryFor(name, modulesDir) {
  const pkgDir = join(modulesDir, name);
  const pkgJson = join(pkgDir, "package.json");
  if (!existsSync(pkgJson)) return null;
  let main = "index.js";
  try {
    main = JSON.parse(readFileSync(pkgJson, "utf8")).main ?? main;
  } catch {
    // an unreadable manifest: fall back to index.js
  }
  const entry = join(pkgDir, main);
  return existsSync(entry) ? entry : null;
}

const dir = process.env.CONVERTER_MODULES_DIR;
if (dir) {
  registerHooks({
    resolve(specifier, context, next) {
      if (NAMES.has(specifier)) {
        const entry = entryFor(specifier, dir);
        if (entry) return { url: pathToFileURL(entry).href, shortCircuit: true };
      }
      return next(specifier, context);
    },
  });
}
