import { declareDesktopHost } from "./bootstrap.js";
import { resolveSidecar } from "./sidecar.js";
import "@powerhousedao/design-system/style.css";
import "@powerhousedao/knowledge-note/style.css";
import "@powerhousedao/workflow/style.css";
import "./host.css";

// Order matters: the vault package runs its package-load boot on import and
// reads the host slot at that moment, so declare before importing anything
// that imports the package (App does).
const info = await resolveSidecar();
declareDesktopHost(info.origin);
const [{ createRoot }, { StrictMode, createElement }, { App }] = await Promise.all([
  import("react-dom/client"),
  import("react"),
  import("./App.js"),
]);
createRoot(document.getElementById("root")!).render(createElement(StrictMode, null, createElement(App, { info })));
