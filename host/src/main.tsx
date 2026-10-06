import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted type (spec §2: nothing leaves the machine): Inter for the UI, Source Serif 4 for vault names.
import "@fontsource-variable/inter";
import "@fontsource-variable/source-serif-4";
import "@powerhousedao/design-system/style.css";
import "@powerhousedao/knowledge-note/style.css";
import "@powerhousedao/workflow/style.css";
import "./host.css";
import { Boot } from "./boot.js";

// Nothing imported here touches the vault package: Boot shows the engine's state
// at once, declares the host when the engine is ready, and only then loads App.
createRoot(document.getElementById("root")!).render(createElement(StrictMode, null, createElement(Boot)));
