import { useEffect, useState, type ReactNode } from "react";
import type { FullGraph, VaultGraphSample } from "../api/graph.js";
import type { VaultSummary } from "../vaults.js";
import { Constellation } from "./Constellation.js";
import { GraphMinimap } from "./GraphMinimap.js";
import { hasUsableLayout } from "./minimap.js";
import { formatOpened } from "./recents.js";
import type { XY } from "./saved-layout.js";

const number = new Intl.NumberFormat("en-US");

export function tileSentence(vault: VaultSummary, sample: VaultGraphSample | null, opened: string | undefined, now = new Date()): string {
  const notes = sample?.noteCount ?? vault.noteCount;
  if (notes === 0) return "No notes yet. Open it and add your first source.";
  const parts = [`${number.format(notes)} note${notes === 1 ? "" : "s"}`];
  if (sample) parts.push(`${number.format(sample.linkCount)} link${sample.linkCount === 1 ? "" : "s"}`);
  return `${parts.join(" and ")}, ${formatOpened(opened, now)}.`;
}

type Props = {
  vault: VaultSummary;
  lead: boolean;
  opened: string | undefined;
  sample: VaultGraphSample | null;
  /** The whole graph, fetched once a saved layout exists; drawn as the real graph when the layout covers it. */
  full?: FullGraph | null;
  saved: Map<string, XY> | null;
  onOpen: () => void;
  /** The ⋯ menu, rendered beside the tile's open area (a button cannot contain a button). */
  menu?: ReactNode;
  /** A vault on another server: named under the title. */
  remote?: { host: string };
};

/** One vault: the open area is a single button; the constellation is the vault's own graph. */
export function VaultTile({ vault, lead, opened, sample, full = null, saved, onOpen, menu, remote }: Props) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (sample === null && full === null) return;
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [sample, full]);
  const wholeGraph = full && saved && hasUsableLayout(full, saved) ? full : null;
  const width = lead ? 660 : 320;
  const height = lead ? 330 : 130;
  return (
    <article className="kv-tile" data-lead={lead}>
      <button type="button" className="kv-tile-main" onClick={onOpen} aria-label={`Open ${vault.name}`}>
        <div className="kv-tile-sky">
          {wholeGraph && saved ? (
            <GraphMinimap graph={wholeGraph} positions={saved} settled={settled} />
          ) : (
            <Constellation sample={sample} saved={saved} seed={vault.id} width={width} height={height} settled={settled} />
          )}
        </div>
        <div className="kv-tile-body">
          <h3 className="kv-tile-name">{vault.name}</h3>
          {remote && <p className="kv-tile-remote">On {remote.host}</p>}
          <p className="kv-tile-meta">{tileSentence(vault, sample, opened)}</p>
        </div>
      </button>
      {menu && <div className="kv-tile-menu">{menu}</div>}
    </article>
  );
}

/** A tile-shaped placeholder while the vaults load. */
export function SkeletonTile({ lead }: { lead: boolean }) {
  return (
    <div className="kv-tile kv-tile-skeleton" data-lead={lead} aria-hidden="true">
      <div className="kv-tile-sky" />
      <div className="kv-tile-body">
        <span className="kv-skeleton-line kv-skeleton-name" />
        <span className="kv-skeleton-line kv-skeleton-meta" />
      </div>
    </div>
  );
}
