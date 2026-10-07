# Manual checks for a built app

The e2e specs run the host in a browser against the dev loop. These checks need the
desktop shell (`bun run dev`, or an installer once Plan 6 builds one) and a person.
Record each run (date, build, result) in the plan's ledger.

## Engine supervision (Plan 5)

1. **Crash loop.** With the app open, kill the engine four times within two minutes
   (`kill -9 $(pgrep -f "[s]idecar/dist/main.js")` each time it is back). The strip
   says "Restarting the engine… Attempt n of 3" after each of the first three, then
   "The engine keeps stopping" with its last lines; no fifth start.
2. **Refusal.** Stop the app, set `"stackVersion": "99.0.0"` in the store's
   `config.json`, start it: "The engine refused to start" with the message naming both
   versions; no restart. Put the old value back.
3. **Upgrade.** With a store written by the previous build (a ~2k-note vault), start the
   new build: Settings › Vaults › Backups lists a backup labelled with the previous
   stack, made before the store opened; the vaults open.

## Window and tray (Plan 5 Task 6)

4. **Close to the tray.** Close the window. The tray icon stays; its menu reads
   "Engine: ready"; `switchboard ping` (or `curl http://127.0.0.1:4201/health`) still
   answers. "Open Knowledge Vault" brings the window back where it was.
5. **Quit.** Tray › Quit: the window and the engine stop; the ports close.
6. **Close quits when asked.** Settings › Appearance › untick "Keep the engine running
   when the window closes"; close the window: the app and the engine stop.
7. **One instance.** Launch the app twice: the second launch focuses the first window;
   one engine runs.
8. **Window state.** Resize and move the window, quit, start: same size and place.

## Data (Plan 5 Tasks 3–5)

9. **Restore.** Back up, change a note, restore the backup: the change is gone, and
   a `pre-restore-…` backup holds it.
10. **Export.** Settings › Vaults › Export on a vault, then Show: the file manager opens
    on `exports/<vault>-<stamp>/`; `scripts/drive-sync/upload.py --data <that folder>`
    in the vault repo restores it into another engine.
11. **Open logs.** Settings › Diagnostics › Open logs opens `<data>/logs/`.

## Pipeline (Plan 2)

12. **A real model.** With a real key in Settings › Models, queue a source in a local
    vault: notes appear and search finds them.
