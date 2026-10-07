import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";

/**
 * A pid alone is not an identity: after a reboot (or on macOS, where pids wrap at 99 999)
 * the number names another program. Records left on disk carry the boot they were made
 * in, and the command line is checked before a pid is trusted or signalled.
 */
export type ProcessProbe = {
  alive: (pid: number) => boolean;
  /** The process's command line, or undefined when it cannot be read. */
  command: (pid: number) => string | undefined;
  /** This boot's start, in seconds since the epoch (stable within a boot to a few seconds). */
  bootTime: () => number;
};

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function command(pid: number): string | undefined {
  try {
    if (process.platform === "linux") return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim() || undefined;
    if (process.platform === "darwin") return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
  return undefined;
}

export const realProbe: ProcessProbe = { alive, command, bootTime: () => Math.round(Date.now() / 1000 - uptime()) };

/** Same boot: the recorded boot time is within a minute of this one's (uptime is not exact). */
export function sameBoot(recorded: unknown, probe: ProcessProbe): boolean {
  return typeof recorded === "number" && Math.abs(recorded - probe.bootTime()) <= 60;
}

/** Write a file so that a reader sees the old content or the new, never half of it. */
export function writeFileAtomic(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
