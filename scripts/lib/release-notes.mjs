/** The release body (spec §11): what the build contains, from the manifests it was built from. */
export function releaseNotes({ app, stack, vaultPackage, node }) {
  return [
    `Knowledge Vault ${app} — the Powerhouse Knowledge Vault on your own computer.`,
    "",
    "### Built from",
    `- Powerhouse stack **${stack}**`,
    `- @powerhousedao/knowledge-note **${vaultPackage}**`,
    `- Node **${node}** (bundled)`,
    "",
    "### Installing",
    "- **Linux** (glibc 2.34+: Ubuntu 22.04, Debian 12, Fedora, RHEL 9 and newer): the `.AppImage` runs as is (`chmod +x`, then open it); the `.deb` installs with `sudo apt install ./<file>.deb`.",
    "- **macOS 13.5+:** these builds are ad-hoc signed, not notarised. Open the `.dmg`, drag the app to Applications, open it once, then **System Settings › Privacy & Security › Open Anyway**.",
    "",
    "Your vaults live in the app's data folder and are kept across updates; a backup is made before a new version opens them.",
  ].join("\n");
}

export function sizeLine(name, bytes) {
  return `| ${name} | ${Math.round(bytes / 1e6)} MB |`;
}

const INSTALLER = /\.(AppImage|deb|dmg)$/;
const SECTION = "\n\n### Installers\n";

/** The notes with one installers table (replacing any previous one, so a re-run never appends a second). */
export function withSizes(body, assets) {
  const base = body.includes(SECTION) ? body.slice(0, body.indexOf(SECTION)) : body.trimEnd();
  const rows = assets.filter((a) => INSTALLER.test(a.name)).map((a) => sizeLine(a.name, a.size));
  return `${base}${SECTION}| File | Size |\n|---|---|\n${rows.join("\n")}\n`;
}

/** What a .deb (from `dpkg-deb -c`) would install into /usr/bin. */
export function debBinaries(listing) {
  return listing
    .split("\n")
    .map((l) => /(?:^|\s)(?:\.\/)?usr\/bin\/([^/\s]+)$/.exec(l.trim())?.[1])
    .filter(Boolean);
}
