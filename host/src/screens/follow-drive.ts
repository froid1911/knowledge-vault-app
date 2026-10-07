import type { PHDocument } from "document-model";

/** The part of reactor-browser's DocumentCache this needs. */
export type DriveCache = {
  get(id: string, refetch?: boolean): Promise<PHDocument>;
  subscribe(id: string | string[], callback: () => void): () => void;
};

/**
 * The drive with the screen's app as its preferred editor when it names none: the
 * GraphQL read carries no header.meta, and that pointer is how the app module is
 * chosen (the drive's own choice wins).
 */
export function withApp<T extends PHDocument>(drive: T, appId: string): T {
  const meta = { preferredEditor: appId, ...(drive.header.meta ?? {}) };
  return { ...drive, header: { ...drive.header, meta } };
}

/**
 * Publishes the drive now and after every change the cache sees — the engine's live
 * events and the host's own refresh after a write. Connect's reactor keeps the
 * `drives` slot current this way; `useSelectedDrive` and the node hooks read it, so a
 * snapshot taken at open would never show a created or deleted document.
 * Returns the stop function.
 */
export function followDrive(
  cache: DriveCache,
  driveId: string,
  appId: string,
  publish: (drive: PHDocument) => void,
  onError: (error: Error) => void = () => {},
): () => void {
  let stopped = false;
  const read = (first: boolean) =>
    cache.get(driveId).then(
      (drive) => {
        if (!stopped) publish(withApp(drive, appId));
      },
      (e: unknown) => {
        if (!stopped && first) onError(e instanceof Error ? e : new Error(String(e)));
      },
    );
  void read(true);
  const unsubscribe = cache.subscribe(driveId, () => void read(false));
  return () => {
    stopped = true;
    unsubscribe();
  };
}
