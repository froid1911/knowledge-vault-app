import { compareVersions } from "./version.js";

export type StackRelation = "fresh" | "same" | "upgrade" | "downgrade";

/** Spec §9: never open a store written by a newer stack; back up before opening one written by an older stack. */
export function compareStack(appStack: string, recorded: string | undefined): StackRelation {
  if (!recorded) return "fresh";
  const c = compareVersions(appStack, recorded);
  return c === 0 ? "same" : c > 0 ? "upgrade" : "downgrade";
}

export const TOO_NEW_MESSAGE = (recorded: string, app: string): string =>
  `This store was last opened by a newer Knowledge Vault (stack ${recorded}) than this one (stack ${app}). Download the newer version to open it.`;
