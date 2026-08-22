#!/usr/bin/env bash
# NetTAP standalone live-capture agent for macOS.
# Capture only networks and interfaces you are authorized to monitor.

set -uo pipefail

ENDPOINT="${NETTAP_ENDPOINT:-https://net-chat-insight.lovable.app/api/public/live-ingest}"
SLICE_SECONDS="${NETTAP_SLICE_SECONDS:-5}"
CAPTURE_FILTER="${NETTAP_CAPTURE_FILTER:-}"
WIRESHARK_APP_BIN="/Applications/Wireshark.app/Contents/MacOS"

if [ -d "$WIRESHARK_APP_BIN" ]; then export PATH="$WIRESHARK_APP_BIN:$PATH"; fi
for command_name in dumpcap tshark curl; do
  command -v "$command_name" >/dev/null 2>&1 || { echo "ERROR: $command_name was not found." >&2; exit 1; }
done
case "$SLICE_SECONDS" in ''|*[!0-9]*|0) echo "ERROR: NETTAP_SLICE_SECONDS must be a positive integer." >&2; exit 1;; esac

echo "Available capture interfaces:"
dumpcap -D || { echo "ERROR: Install the Wireshark ChmodBPF helper." >&2; exit 1; }
printf "Enter the interface name or number shown above [en0]: "; read -r IFACE; IFACE="${IFACE:-en0}"

restore_terminal() { stty echo 2>/dev/null || true; }
printf "Paste the newly rotated NetTAP session token: "
trap restore_terminal INT TERM EXIT
stty -echo; read -r NETTAP_TOKEN; stty echo; trap - INT TERM EXIT; printf "\n"
[ -n "$NETTAP_TOKEN" ] || { echo "ERROR: A session token is required." >&2; exit 1; }

SPOOL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nettap-live.XXXXXX")"
cleanup() { NETTAP_TOKEN=""; echo; echo "Capture stopped. Review retained files in: $SPOOL_DIR"; }
stop_capture() { exit 130; }
trap cleanup EXIT; trap stop_capture INT TERM

TEST_CAPTURE="$SPOOL_DIR/interface-test.pcapng"
echo "Testing interface $IFACE for one second..."
dumpcap -i "$IFACE" -a duration:1 -c 1 -w "$TEST_CAPTURE" -q || exit 1
rm -f "$TEST_CAPTURE"
echo "Capture started. Press Ctrl+C to stop."
echo "Decoded packet evidence is being sent to: $ENDPOINT"

while true; do
  TIMESTAMP="$(date +%Y%m%d-%H%M%S)-$$"
  CAPTURE_FILE="$SPOOL_DIR/slice-$TIMESTAMP.pcapng"
  EK_FILE="$SPOOL_DIR/slice-$TIMESTAMP.ndjson"
  CAPTURE_ARGS=(-i "$IFACE" -a "duration:$SLICE_SECONDS" -w "$CAPTURE_FILE" -q)
  [ -z "$CAPTURE_FILTER" ] || CAPTURE_ARGS+=(-f "$CAPTURE_FILTER")
  dumpcap "${CAPTURE_ARGS[@]}" || break
  [ -s "$CAPTURE_FILE" ] || { echo "ERROR: No capture file." >&2; break; }
  tshark -r "$CAPTURE_FILE" -T ek > "$EK_FILE" 2>/dev/null || { echo "ERROR: Decode failed." >&2; break; }
  [ -s "$EK_FILE" ] || { echo "ERROR: No decoded records." >&2; break; }
  HTTP_STATUS="$({ curl --silent --show-error --output "$SPOOL_DIR/last-response.json" --write-out '%{http_code}' \
    --max-time 30 --request POST "$ENDPOINT" --header "Authorization: Bearer $NETTAP_TOKEN" \
    --header "Content-Type: application/x-ndjson" --data-binary "@$EK_FILE"; } || true)"
  if [[ "$HTTP_STATUS" =~ ^2[0-9][0-9]$ ]]; then
    cat "$SPOOL_DIR/last-response.json"; echo
    rm -f "$CAPTURE_FILE" "$EK_FILE" "$SPOOL_DIR/last-response.json"
  else
    echo "ERROR: Upload returned HTTP status ${HTTP_STATUS:-unknown}. Evidence retained in $SPOOL_DIR." >&2
    break
  fi
done

