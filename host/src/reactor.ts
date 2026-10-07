import {
  DocumentCache,
  ensurePHEventHandlers,
  GraphQLReactorClient,
  setDefaultDrivesUrl,
  setDocumentCache,
  setReactorClient,
  setSwitchboardUrl,
  setVetraPackageManager,
  StaticPackageManager,
} from "@powerhousedao/reactor-browser";
import type { DocumentModelLib } from "document-model";
import type { SidecarInfo } from "./sidecar.js";

export type Target = {
  /** The Switchboard this client talks to, e.g. "http://127.0.0.1:4201" or "https://switchboard.example.com". */
  origin: string;
  /** Per-request bearer; none for an open local engine. */
  tokenProvider?: () => Promise<string | undefined>;
};

let libs: readonly DocumentModelLib[] = [];
const clients = new Map<string, GraphQLReactorClient>();

/**
 * What Connect's boot does for us, minus the in-browser reactor: one
 * Switchboard-backed client per origin (with every document model, so
 * multi-action batches can be signed), a document cache over the active one,
 * and a package manager holding the vault and workflow packages — editors
 * included, which is why GraphQLReactorProvider (models only) is not used here.
 */
export function clientFor(target: Target): GraphQLReactorClient {
  let client = clients.get(target.origin);
  if (!client) {
    client = new GraphQLReactorClient({
      url: `${target.origin}/graphql`,
      documentModels: libs.flatMap((lib) => [...lib.documentModels]),
      ...(target.tokenProvider ? { tokenProvider: target.tokenProvider } : {}),
    });
    clients.set(target.origin, client);
  }
  return client;
}

/** Make `target` the Switchboard the mounted apps talk to. Returns its client. */
export function activate(target: Target): GraphQLReactorClient {
  const client = clientFor(target);
  setReactorClient(client);
  setDocumentCache(new DocumentCache(client));
  setSwitchboardUrl(`${target.origin}/graphql`);
  // Workflow Studio derives its runtime endpoint from the drive's sync channel or, failing
  // that, from the default drives URL — never from the Switchboard URL. There is no sync
  // manager here, so the default drives URL names the active engine.
  setDefaultDrivesUrl(`${target.origin}/d/workflows`);
  return client;
}

/**
 * The packages, then the local engine as the active target. Runs again after the
 * engine restarted (the protection switch): the local client is rebuilt, because
 * its bearer is bound at creation and a protected engine needs one.
 */
export function installReactor(info: SidecarInfo, packages: readonly DocumentModelLib[], tokenProvider?: Target["tokenProvider"]): GraphQLReactorClient {
  ensurePHEventHandlers();
  libs = packages;
  setVetraPackageManager(new StaticPackageManager(packages));
  clients.delete(info.origin);
  return activate({ origin: info.origin, ...(tokenProvider ? { tokenProvider } : {}) });
}
