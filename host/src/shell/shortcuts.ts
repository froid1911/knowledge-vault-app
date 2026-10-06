export type Shortcut = "new-vault" | "settings";

/** Ctrl/⌘+N — new vault; Ctrl/⌘+, — settings. Only on the shell's own screens, never inside a workspace. */
export function matchShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): Shortcut | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key.toLowerCase() === "n" && !e.shiftKey) return "new-vault";
  if (e.key === ",") return "settings";
  return null;
}
