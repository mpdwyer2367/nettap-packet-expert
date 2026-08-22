# syntax=docker/dockerfile:1
# =============================================================================
# AMDAI collector appliance image.
# Build context: collector/ (see deploy/docker-compose.yml -> context: ..)
#   docker build -f deploy/Dockerfile -t amdai-collector ..
#
# Stage 1: compile the TypeScript collector with the full dev toolchain.
# Stage 2: minimal runtime with Node 20, tshark/dumpcap, and non-root capture
#          capabilities granted to dumpcap only (not the whole container).
# =============================================================================

FROM node:20-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
ARG DUMPCAP_GROUP=amdai-capture
ENV NODE_ENV=production \
    AMDAI_HOME=/opt/amdai/collector

# tshark/tcpdump pull in dumpcap; curl is used by the container healthcheck;
# libcap2-bin provides setcap for the non-root capture grant below.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
       tshark curl ca-certificates libcap2-bin gosu \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system "${DUMPCAP_GROUP}" \
    && useradd --system --create-home --shell /usr/sbin/nologin \
       --gid "${DUMPCAP_GROUP}" amdai \
    # Grant dumpcap raw-capture capabilities directly on the binary instead
    # of running the process (or the container) as root or with --privileged.
    && setcap cap_net_raw,cap_net_admin=eip /usr/bin/dumpcap \
    && chgrp "${DUMPCAP_GROUP}" /usr/bin/dumpcap \
    && chmod 750 /usr/bin/dumpcap \
    && usermod -aG wireshark amdai 2>/dev/null || true

WORKDIR ${AMDAI_HOME}
COPY --from=build /build/package.json /build/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=build /build/dist ./dist
COPY config ./config

RUN mkdir -p "${AMDAI_HOME}/data/spool" "${AMDAI_HOME}/config" \
    && chown -R amdai:${DUMPCAP_GROUP} "${AMDAI_HOME}"

# The image still starts as root (via the entrypoint below) only long enough
# to reconcile ownership of bind-mounted volumes, then drops to the
# unprivileged "amdai" user with gosu. NET_ADMIN/NET_RAW are supplied by the
# container's Linux capabilities (docker-compose cap_add) so dumpcap works
# without the process ever running as root.
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8787/tcp 2055/udp 4739/udp 6343/udp

HEALTHCHECK --interval=15s --timeout=5s --retries=6 --start-period=20s \
    CMD curl -fsS "http://127.0.0.1:${AMDAI_API_PORT:-8787}/healthz" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
