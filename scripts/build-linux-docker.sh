#!/usr/bin/env bash
# Builds the Linux installers inside ubuntu:22.04 — the glibc the release workflow builds against —
# so the AppImage runs on older distributions too. A build on this machine links against its own,
# newer glibc. Artefacts land in dist-linux/{appimage,deb}/.
# The repository is copied into the container (node_modules, targets and stores excluded).
set -euo pipefail
cd "$(dirname "$0")/.."
image=knowledge-vault-app-build:22.04
docker build -t "$image" - <<'DOCKERFILE'
FROM ubuntu:22.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y curl wget file unzip xz-utils git build-essential pkg-config \
    libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf \
 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs
RUN curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal
RUN curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"
ENV PATH=/root/.cargo/bin:/root/.bun/bin:$PATH
# linuxdeploy is an AppImage itself; containers have no FUSE
ENV APPIMAGE_EXTRACT_AND_RUN=1
WORKDIR /src
DOCKERFILE
docker run --rm -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$PWD:/host:ro" -v "$PWD/dist-linux:/out" \
  -v kv-build-cargo:/root/.cargo/registry -v kv-build-cache:/root/.cache \
  "$image" bash -lc '
    set -euo pipefail
    tar -C /host --exclude=./node_modules --exclude="*/node_modules" --exclude=./src-tauri/target --exclude=./.stage \
        --exclude=./.dev-data --exclude=./.e2e-data --exclude=./spike -cf - . | tar -xf - -C /src
    bun install --frozen-lockfile
    bun run build:app
    rm -rf /out/appimage /out/deb
    cp -r src-tauri/target/release/bundle/appimage src-tauri/target/release/bundle/deb /out/
    chown -R "$HOST_UID:$HOST_GID" /out
  '
echo "[build-linux-docker] artefacts in dist-linux/ (built against Ubuntu 22.04's glibc)"
