import { RenownProvider, type GraphQLReactorClient } from "@powerhousedao/reactor-browser";
import * as knowledgeNote from "@powerhousedao/knowledge-note";
import * as workflow from "@powerhousedao/workflow";
import type { DocumentModelLib } from "document-model";
import { useCallback, useEffect } from "react";
import { Landing } from "./screens/Landing.js";
import { Settings } from "./screens/Settings.js";
import { WorkflowsScreen } from "./screens/WorkflowsScreen.js";
import { WorkspaceScreen } from "./screens/WorkspaceScreen.js";
import { useRoute } from "./shell/router.js";
import { matchShortcut } from "./shell/shortcuts.js";
import type { SidecarInfo } from "./sidecar.js";

/** The packages the host mounts; boot.tsx installs the reactor with their document models, once. */
export const LIBS: readonly DocumentModelLib[] = [
  knowledgeNote as unknown as DocumentModelLib,
  workflow as unknown as DocumentModelLib,
];

export function App({ info, client }: { info: SidecarInfo; client: GraphQLReactorClient }) {
  const [route, navigate] = useRoute();
  const toVaults = useCallback(() => navigate({ name: "vaults" }), [navigate]);
  const toSettings = useCallback(() => navigate({ name: "settings", section: "vaults" }), [navigate]);
  const toWorkflows = useCallback(() => navigate({ name: "workflows" }), [navigate]);
  const inWorkspace = route.name === "vault" || route.name === "workflows";

  // Shortcuts only on the shell's own screens: a workspace app owns its keys.
  useEffect(() => {
    if (inWorkspace) return;
    const onKey = (e: KeyboardEvent) => {
      const s = matchShortcut(e);
      if (!s) return;
      e.preventDefault();
      if (s === "new-vault") navigate({ name: "vaults", newVault: true });
      else toSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inWorkspace, navigate, toSettings]);

  let screen;
  switch (route.name) {
    case "vault":
      screen = <WorkspaceScreen client={client} driveId={route.id} appId="knowledge-vault" onBack={toVaults} onSettings={toSettings} />;
      break;
    case "workflows":
      screen = <WorkflowsScreen info={info} client={client} onBack={toVaults} onSettings={toSettings} />;
      break;
    case "settings":
      screen = <Settings info={info} section={route.section} onSection={(section) => navigate({ name: "settings", section })} onBack={toVaults} onOpenWorkflows={toWorkflows} />;
      break;
    default:
      screen = (
        <Landing
          engine={{ state: "ready" }}
          info={info}
          newVault={route.newVault === true}
          onNewVaultDone={toVaults}
          onOpen={(v) => navigate({ name: "vault", id: v.id })}
          onWorkflows={toWorkflows}
          onSettings={toSettings}
        />
      );
  }
  return (
    <RenownProvider appName="desktop-knowledge-vault" url="https://www.renown.id" switchboardUrl={info.origin}>
      {screen}
    </RenownProvider>
  );
}
