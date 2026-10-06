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
