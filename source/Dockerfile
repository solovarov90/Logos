FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    python3 \
    make \
    g++ \
    git \
    ca-certificates \
    unzip \
    && rm -rf /var/lib/apt/lists/*
    
# Update CA certificates
RUN update-ca-certificates

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

ENV CI=true
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
# Force pnpm for UI build
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

# Prune dev dependencies to save space
RUN pnpm prune --prod

ENV NODE_ENV=production

# Allow non-root user to write temp files during runtime/tests.
RUN chown -R node:node /app

# Copy sync script and make executable
COPY scripts/start-with-sync.sh /app/start.sh
RUN chmod +x /app/start.sh

# Security hardening: Run as non-root user
USER node

CMD ["/app/start.sh"]
