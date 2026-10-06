import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@powerhousedao/design-system/style.css";
import "@powerhousedao/knowledge-note/style.css";
import "@powerhousedao/workflow/style.css";
import "./host.css";
import { Boot } from "./boot.js";

// Nothing imported here touches the vault package: Boot shows the engine's state
// at once, declares the host when the engine is ready, and only then loads App.
createRoot(document.getElementById("root")!).render(createElement(StrictMode, null, createElement(Boot)));
