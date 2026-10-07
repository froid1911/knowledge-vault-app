export function parseReadyLine(line) {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  try {
    const v = JSON.parse(t);
    if (v && v.event === "ready" && Number.isInteger(v.port) && Number.isInteger(v.controlPort)) {
      return { port: v.port, controlPort: v.controlPort };
    }
  } catch {
    // not JSON
  }
  return null;
}

/** `{"event":"restart","reason":"protection"}` → { reason }; anything else → null. */
export function parseRestartLine(line) {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  try {
    const v = JSON.parse(t);
    if (v && v.event === "restart") return { reason: typeof v.reason === "string" ? v.reason : "" };
  } catch {
    // not JSON
  }
  return null;
}

function parseEvent(line) {
  const t = line.trim();
  if (!t.startsWith("{")) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** `{"event":"fatal","reason":…,"message":…}` — the engine refused to start and said why. */
export function parseFatalLine(line) {
  const v = parseEvent(line);
  return v && v.event === "fatal" ? { reason: String(v.reason ?? ""), message: String(v.message ?? "") } : null;
}

/** `{"event":"shutdown"}` — the engine is stopping on request; its exit is not a crash. */
export function parseShutdownLine(line) {
  const v = parseEvent(line);
  return !!v && v.event === "shutdown";
}
