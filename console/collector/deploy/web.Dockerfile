# syntax=docker/dockerfile:1
# =============================================================================
# AMDAI web/console tier image (the TanStack Start app in /src, /public etc).
# Build context: repo root (see deploy/docker-compose.yml -> context: ../..)
#   docker build -f collector/deploy/web.Dockerfile -t amdai-web .
# =============================================================================

FROM node:20-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json* bun.lock* ./
RUN npm ci || npm install
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN npm install -g serve@14 \
    && useradd --system --create-home --shell /usr/sbin/nologin amdai
WORKDIR /app
COPY --from=build /build/dist ./dist
USER amdai
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=6 --start-period=20s \
    CMD curl -fsS http://127.0.0.1:8080/ || exit 1
CMD ["serve", "-s", "dist", "-l", "8080"]
