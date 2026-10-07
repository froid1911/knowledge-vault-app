/**
 * The slot `editors/shared/host-config.ts` in the vault package reads at call
 * time. The host writes it directly — it loads before the package — and
 * dispatches the package's change event so its hooks re-read it.
 */
export const HOST_SLOT = "__knowledgeVaultHost";
export const HOST_CHANGED_EVENT = "knowledge-vault-host:changed";

export type HostIdentity = { address: string; did?: string; ensName?: string };
export type HostExtras = {
  /** The bearer for this origin, per request; absent for an open local engine. */
  bearer?: () => Promise<string | undefined>;
  /** Who the app is signed in as; absent when nobody is. */
  identity?: HostIdentity;
};

/** Runs a sign-in in the system browser and resolves with the code (the vault chat's OpenRouter connect). */
export type ExternalSignIn = (buildUrl: (callbackUrl: string) => string) => Promise<string>;
let externalSignIn: ExternalSignIn | undefined;
/** Set once at boot; every declaration carries it, whichever screen declares. */
export function setExternalSignIn(fn: ExternalSignIn | undefined): void {
  externalSignIn = fn;
}

export function declareDesktopHost(switchboardOrigin: string, extras: HostExtras = {}): void {
  (globalThis as Record<string, unknown>)[HOST_SLOT] = {
    kind: "desktop",
    switchboardOrigin,
    ...(extras.bearer ? { bearer: extras.bearer } : {}),
    ...(extras.identity ? { identity: { ...extras.identity } } : {}),
    ...(externalSignIn ? { externalSignIn } : {}),
  };
  if (typeof globalThis.dispatchEvent === "function" && typeof Event === "function") globalThis.dispatchEvent(new Event(HOST_CHANGED_EVENT));
}
