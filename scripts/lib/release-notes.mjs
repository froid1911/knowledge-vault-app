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
    "- **Linux:** the `.AppImage` runs as is (`chmod +x`, then open it); the `.deb` installs with `sudo apt install ./<file>.deb`.",
    "- **macOS:** these builds are not signed yet. Open the `.dmg`, drag the app to Applications, then right-click it → **Open** the first time.",
    "",
    "Your vaults live in the app's data folder and are kept across updates; a backup is made before a new version opens them.",
  ].join("\n");
}

export function sizeLine(name, bytes) {
  return `| ${name} | ${Math.round(bytes / 1e6)} MB |`;
}
