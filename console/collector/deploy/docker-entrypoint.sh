#!/usr/bin/env bash
# Reconciles ownership of bind-mounted volumes, then drops privileges to the
# unprivileged "amdai" user before exec'ing the collector.
set -euo pipefail

AMDAI_HOME="${AMDAI_HOME:-/opt/amdai/collector}"

if [ "$(id -u)" = "0" ]; then
  chown -R amdai:amdai-capture "${AMDAI_HOME}/data" "${AMDAI_HOME}/config" 2>/dev/null || true
  exec gosu amdai "$@"
fi

exec "$@"
