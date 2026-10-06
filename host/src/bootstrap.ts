/** The slot `editors/shared/host-config.ts` in the vault package reads at call time. */
export const HOST_SLOT = "__knowledgeVaultHost";
export function declareDesktopHost(switchboardOrigin: string): void {
  (globalThis as Record<string, unknown>)[HOST_SLOT] = { kind: "desktop", switchboardOrigin };
}
