import {
  DocumentCache,
  ensurePHEventHandlers,
  GraphQLReactorClient,
  setDocumentCache,
  setDefaultDrivesUrl,
  setReactorClient,
  setSwitchboardUrl,
  setVetraPackageManager,
  StaticPackageManager,
} from "@powerhousedao/reactor-browser";
import type { DocumentModelLib } from "document-model";
import type { SidecarInfo } from "./sidecar.js";

/**
 * What Connect's boot does for us, minus the in-browser reactor: one
 * Switchboard-backed client (with every document model, so multi-action
 * batches can be signed), a document cache over it, and a package manager
 * holding the vault and workflow packages — editors included, which is why
 * GraphQLReactorProvider (models only) is not used here.
 */
export function installReactor(info: SidecarInfo, libs: readonly DocumentModelLib[]): GraphQLReactorClient {
  ensurePHEventHandlers();
  const documentModels = libs.flatMap((lib) => [...lib.documentModels]);
  const client = new GraphQLReactorClient({ url: info.graphqlUrl, documentModels });
  setReactorClient(client);
  setSwitchboardUrl(info.graphqlUrl);
  // Workflow Studio derives its runtime endpoint from the drive's sync channel or, failing
  // that, from the default drives URL — never from the Switchboard URL. There is no sync
  // manager here, so the default drives URL names this engine.
  setDefaultDrivesUrl(`${info.origin}/d/workflows`);
  setDocumentCache(new DocumentCache(client));
  setVetraPackageManager(new StaticPackageManager(libs));
  return client;
}
