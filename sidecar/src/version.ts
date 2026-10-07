/**
 * Semver with a numeric prerelease tail (`6.2.3-dev.44`): a release outranks
 * its prereleases; identifiers compare numerically when both are numbers.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const [ca, pa] = split(a);
  const [cb, pb] = split(b);
  for (let i = 0; i < 3; i++) {
    if ((ca[i] ?? 0) !== (cb[i] ?? 0)) return (ca[i] ?? 0) < (cb[i] ?? 0) ? -1 : 1;
  }
  if (pa.length === 0 && pb.length === 0) return 0;
  if (pa.length === 0) return 1;
  if (pb.length === 0) return -1;
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = Number(x);
    const ny = Number(y);
    const c = Number.isInteger(nx) && Number.isInteger(ny) ? Math.sign(nx - ny) : x < y ? -1 : x > y ? 1 : 0;
    if (c !== 0) return c as -1 | 1;
  }
  return 0;
}
function split(v: string): [number[], string[]] {
  const trimmed = v.trim();
  const dash = trimmed.indexOf("-");
  const core = dash === -1 ? trimmed : trimmed.slice(0, dash);
  const pre = dash === -1 ? "" : trimmed.slice(dash + 1);
  return [core.split(".").map((p) => Number.parseInt(p, 10) || 0), pre ? pre.split(".") : []];
}
