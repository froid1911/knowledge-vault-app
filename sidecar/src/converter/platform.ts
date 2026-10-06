/** The npm platform packages `docling.rs` publishes a native binding for. */
export type PlatformTriple = "linux-x64-gnu" | "linux-arm64-gnu" | "win32-x64-msvc";

/** A Linux without glibc (Alpine, …) gets a musl build upstream does not publish for us. Mirrors native.js's probe. */
export function isMusl(platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "linux") return false;
  try {
    const header = (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header;
    return !header?.glibcVersionRuntime;
  } catch {
    return false;
  }
}

/** Which binding this machine can install, or why none. */
export function platformTriple(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
  musl: boolean = isMusl(platform),
): { triple: PlatformTriple | null; reason: string | null } {
  if (platform === "linux") {
    if (musl) return { triple: null, reason: "docling.rs publishes no binding for musl-based Linux." };
    if (arch === "x64") return { triple: "linux-x64-gnu", reason: null };
    if (arch === "arm64") return { triple: "linux-arm64-gnu", reason: null };
  }
  if (platform === "win32" && arch === "x64") return { triple: "win32-x64-msvc", reason: null };
  if (platform === "darwin") return { triple: null, reason: "The converter for macOS is coming — docling.rs publishes no macOS binding yet; text PDFs, Markdown and plain text work now." };
  return { triple: null, reason: `docling.rs publishes no binding for ${platform}/${arch}.` };
}
