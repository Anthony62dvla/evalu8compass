#!/usr/bin/env bash
#
# Evalu8 Compass — self-healing guard (runs every 5 minutes via hwwd-guard.timer)
#   1. If the app stops answering twice in a row, restart it.
#   2. If the site's block has disappeared from the shared Caddy container's
#      Caddyfile (for example after the other project redeploys), put it back.
# Everything it does is logged:  journalctl -t hwwd-guard
set -uo pipefail

APP_DIR="${HWWD_APP_DIR:-/opt/hwwd}"
STATE_DIR="${HWWD_GUARD_STATE:-/var/lib/hwwd-guard}"
PROXY_CONF="${HWWD_PROXY_CONF:-/etc/hwwd/proxy.conf}"
log() { logger -t hwwd-guard -- "$*" 2>/dev/null || true; echo "hwwd-guard: $*"; }
mkdir -p "$STATE_DIR"

# ---------- 1. app health ----------
HOST="$(grep -E '^HOST=' "$APP_DIR/.env" 2>/dev/null | head -1 | sed -E 's/^HOST=([^ ]*).*/\1/')"
PORT="$(grep -E '^PORT=' "$APP_DIR/.env" 2>/dev/null | head -1 | sed -E 's/^PORT=([0-9]+).*/\1/')"
case "$HOST" in ""|0.0.0.0) HOST=127.0.0.1 ;; esac
PORT="${PORT:-3100}"
FAILS_FILE="$STATE_DIR/health-fails"
if curl -fsS --max-time 8 "http://$HOST:$PORT/api/health" >/dev/null 2>&1; then
  [ -f "$FAILS_FILE" ] && { log "app is answering again"; rm -f "$FAILS_FILE"; }
else
  n=$(( $(cat "$FAILS_FILE" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$FAILS_FILE"
  log "app didn't answer on $HOST:$PORT (check $n)"
  if [ "$n" -ge 2 ]; then
    log "restarting hwwd"
    systemctl restart hwwd || log "restart failed: see journalctl -u hwwd"
    echo 0 > "$FAILS_FILE"
  fi
fi

# ---------- 2. shared Caddy container ----------
if [ -f "$PROXY_CONF" ] && command -v docker >/dev/null; then
  # shellcheck disable=SC1090
  . "$PROXY_CONF"
  if [ "$(docker inspect -f '{{.State.Running}}' "${CONTAINER:-}" 2>/dev/null)" = "true" ]; then
    CF="$(docker inspect "$CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')"
    if [ -z "$CF" ]; then
      DIR="$(docker inspect "$CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}')"
      [ -n "$DIR" ] && CF="$DIR/Caddyfile"
    fi
    if [ -n "$CF" ] && [ -f "$CF" ] && ! grep -q "added by How Well Are We Doing" "$CF"; then
      log "$DOMAIN block missing from $CF; putting it back"
      if bash "$APP_DIR/deploy/connect-docker-caddy.sh" "$CONTAINER" "$DOMAIN" >"$STATE_DIR/last-repair.log" 2>&1; then
        log "repaired: $DOMAIN is back in $CONTAINER"
      else
        log "repair FAILED, see $STATE_DIR/last-repair.log"
      fi
    fi
  else
    log "Caddy container ${CONTAINER:-?} isn't running; nothing to repair until it is"
  fi
fi
exit 0
