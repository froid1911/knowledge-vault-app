/** The Node bundled with the app — one place. 24 is the LTS line the Switchboard's own image uses. */
export const NODE_VERSION = "24.21.0";

/**
 * SHA-256 of each official archive, pinned here (from nodejs.org/dist/v24.21.0/SHASUMS256.txt,
 * checked against a second download on 2026-10-07): the build trusts the repository, not whatever
 * the download site serves on the day. A version bump updates these with it.
 */
export const NODE_SHA256 = {
  "node-v24.21.0-linux-x64.tar.xz": "fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6",
  "node-v24.21.0-linux-arm64.tar.xz": "6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2",
  "node-v24.21.0-darwin-arm64.tar.xz": "6239d4cf92d864487ec8cd3615038f7b67e7f58b77b21cd2f09ea9fbd68065fe",
  "node-v24.21.0-darwin-x64.tar.xz": "0ae5a24c24bb7d015cd816c5036b3f90f2945aa872fcf54e58da054753b3a299",
  // From SHASUMS256.txt, checked against a download on 2026-10-07.
  "node-v24.21.0-win-x64.zip": "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541",
};
