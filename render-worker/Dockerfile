# The self-hosted creative render worker. Build from the repository root:
#
#   docker build -f render-worker/Dockerfile -t studio-render-worker .
#   docker run -d --restart unless-stopped -p 8787:8787 \
#     -e RENDER_WORKER_SECRET=... studio-render-worker
#
# See render-worker/README.md.
FROM node:22-bookworm-slim

# Shared libraries Chrome Headless Shell needs, and fonts for anything the
# composition does not load itself.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 \
      libxrandr2 libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 \
      libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
      fonts-noto-core fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY tsconfig.json ./
COPY lib ./lib
COPY remotion ./remotion
COPY render-worker ./render-worker

# Bundle the composition and fetch Chrome at build time, so the container
# starts serving in seconds and needs no download when it does.
# Each job's media is copied into the bundle's public folder, so the
# unprivileged user must be able to write there.
RUN npx remotion bundle remotion/index.ts --out-dir /app/.remotion-worker-bundle \
    && npx remotion browser ensure \
    && chown -R node:node /app/.remotion-worker-bundle

ENV NODE_ENV=production \
    PORT=8787 \
    RENDER_WORKER_BUNDLE_DIR=/app/.remotion-worker-bundle
EXPOSE 8787
USER node
CMD ["npx", "tsx", "render-worker/server.ts"]
