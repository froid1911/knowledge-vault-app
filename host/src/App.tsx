import { RenownProvider, type GraphQLReactorClient } from "@powerhousedao/reactor-browser";
import * as knowledgeNote from "@powerhousedao/knowledge-note";
import * as workflow from "@powerhousedao/workflow";
import type { DocumentModelLib } from "document-model";
import { useState } from "react";
import { Landing } from "./screens/Landing.js";
import { VaultScreen } from "./screens/VaultScreen.js";
import type { SidecarInfo } from "./sidecar.js";

/** The packages the host mounts; boot.tsx installs the reactor with their document models, once. */
export const LIBS: readonly DocumentModelLib[] = [
  knowledgeNote as unknown as DocumentModelLib,
  workflow as unknown as DocumentModelLib,
];
type Route = { name: "landing" } | { name: "vault"; id: string; title: string };

export function App({ info, client }: { info: SidecarInfo; client: GraphQLReactorClient }) {
  const [route, setRoute] = useState<Route>({ name: "landing" });
  return (
    <RenownProvider appName="desktop-knowledge-vault" url="https://www.renown.id" switchboardUrl={info.origin}>
      {route.name === "landing" ? (
        <Landing engine={{ state: "ready" }} info={info} onOpen={(v) => setRoute({ name: "vault", id: v.id, title: v.name })} />
      ) : (
        <VaultScreen client={client} driveId={route.id} title={route.title} onBack={() => setRoute({ name: "landing" })} />
      )}
    </RenownProvider>
  );
}
