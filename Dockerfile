# Forge builder image: Node LTS + the NEWEST Atlassian Forge CLI.
#
# Built and published to GHCR by .github/workflows/forge-image.yml (weekly and
# on changes to this file), then used as the job container for CI in
# .github/workflows/deploy.yml — so every pipeline run gets a consistent,
# pre-provisioned toolchain instead of installing Node + Forge ad hoc.
#
# The image is tagged both :latest and :<forge-cli-version> so a specific CLI
# version can be pinned for reproducibility/audit if required.
FROM node:22-bookworm-slim

# git: needed by CI checkouts and Forge CLI; ca-certificates: TLS to Atlassian
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Always the newest Forge CLI at build time — the weekly image rebuild is what
# keeps "newest" true over time.
RUN npm install -g @forge/cli@latest && forge --version

# Link the GHCR package back to this repo
LABEL org.opencontainers.image.source="https://github.com/jabrealmoe/finra-regulated-user-tracker" \
      org.opencontainers.image.description="Node 22 + latest Atlassian Forge CLI (CI builder image)"

WORKDIR /app
