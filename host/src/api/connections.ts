import type { SidecarInfo } from "../sidecar.js";
import { control } from "../vaults.js";

/** Mirrors the engine's POST /connections/:id/fill (sidecar/src/connections.ts). */
export type FillResult = { baseUrl: string; token: { kind: "open" | "minted"; expiresAt: string | null } | null };

export const fillConnection = (info: SidecarInfo, id: string, token: boolean, f: typeof fetch = fetch) =>
  control<{ connection: FillResult }>(info, `/connections/${encodeURIComponent(id)}/fill`, { method: "POST", body: JSON.stringify({ token }) }, f).then((r) => r.connection);
