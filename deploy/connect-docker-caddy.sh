#!/usr/bin/env bash
#
# Connect How Well Are We Doing? to a Caddy server that runs in Docker
# (for a VPS where another project's Caddy container already owns ports 80/443).
#
# Usage (as root):  bash deploy/connect-docker-caddy.sh <caddy-container> <domain>
#   e.g.            bash deploy/connect-docker-caddy.sh vicisrota-caddy-1 evalu8compass.app
#
# What it does:
#   1. Makes the app listen on Docker's private bridge address (e.g. 172.17.0.1),
#      which containers can reach but the internet can't.
#   2. Checks the Caddy container can reach the app.
#   3. Appends one site block for <domain> (and www.<domain>) to that container's
#      Caddyfile, validates it, and reloads Caddy. If validation fails, the
#      Caddyfile is restored exactly and Caddy is left untouched.
# Safe to re-run.
set -euo pipefail

CONTAINER="${1:-}"; DOMAIN="${2:-}"
APP_DIR=/opt/hwwd
say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERR\033[0m %s\n' "$*" >&2; exit 1; }

[ -n "$CONTAINER" ] && [ -n "$DOMAIN" ] || die "Usage: bash deploy/connect-docker-caddy.sh <caddy-container> <domain>"
[ "$(id -u)" = 0 ] || die "Run as root."
[ -f "$APP_DIR/.env" ] || die "$APP_DIR/.env not found. Run deploy/install.sh first."
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "No container called $CONTAINER. See: docker ps"
PORT="$(grep -E '^PORT=' "$APP_DIR/.env" | head -1 | sed -E 's/^PORT=([0-9]+).*/\1/' || true)"; PORT="${PORT:-3100}"

# ---------- 1. listen on the Docker bridge ----------
say "Finding Docker's bridge address"
BRIDGE_IP="$(ip -4 -o addr show docker0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1 || true)"
[ -n "$BRIDGE_IP" ] || die "Couldn't find the docker0 bridge address."
ok "docker0 is $BRIDGE_IP (private, not reachable from the internet)"

say "Pointing the app at $BRIDGE_IP:$PORT"
CHANGED=0
if grep -q "^HOST=$BRIDGE_IP\b" "$APP_DIR/.env"; then ok "Already set"
elif grep -q '^HOST=' "$APP_DIR/.env"; then sed -i -E "s/^HOST=[^ ]*/HOST=$BRIDGE_IP/" "$APP_DIR/.env"; CHANGED=1
else echo "HOST=$BRIDGE_IP" >> "$APP_DIR/.env"; CHANGED=1; fi
UNIT=/etc/systemd/system/hwwd.service
if [ -f "$UNIT" ] && ! grep -q '^After=.*docker.service' "$UNIT"; then
  sed -i -E 's/^After=(.*)$/After=\1 docker.service/' "$UNIT"
  sed -i -E 's/^Wants=(.*)$/Wants=\1 docker.service/' "$UNIT"
  CHANGED=1
fi
if [ "$CHANGED" = 1 ] || ! curl -fsS "http://$BRIDGE_IP:$PORT/api/health" >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl restart hwwd
fi
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -fsS "http://$BRIDGE_IP:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://$BRIDGE_IP:$PORT/api/health" >/dev/null 2>&1 || { journalctl -u hwwd -n 20 --no-pager; die "The app didn't start on $BRIDGE_IP:$PORT."; }
ok "App answering on $BRIDGE_IP:$PORT"

# ---------- 2. can Caddy reach it? ----------
say "Checking $CONTAINER can reach the app"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow from 172.16.0.0/12 to "$BRIDGE_IP" port "$PORT" proto tcp >/dev/null && ok "Firewall: allowed Docker containers to reach port $PORT"
fi
if docker exec "$CONTAINER" wget -qO- -T 5 "http://$BRIDGE_IP:$PORT/api/health" >/dev/null 2>&1; then ok "Reachable from $CONTAINER"
else die "$CONTAINER can't reach http://$BRIDGE_IP:$PORT. Nothing in Caddy has been changed."; fi

# Remember this setup so the guard (deploy/guard.sh) can repair it if it's ever undone
mkdir -p /etc/hwwd
printf 'CONTAINER=%q\nDOMAIN=%q\n' "$CONTAINER" "$DOMAIN" > /etc/hwwd/proxy.conf

# ---------- 3. Caddyfile ----------
say "Finding $CONTAINER's Caddyfile"
CF="$(docker inspect "$CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')"
if [ -z "$CF" ]; then
  DIR="$(docker inspect "$CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}')"
  [ -n "$DIR" ] && CF="$DIR/Caddyfile"
fi
[ -n "$CF" ] && [ -f "$CF" ] || die "The Caddyfile isn't mounted from the host, so it can't be edited safely here. Nothing has been changed."
ok "Caddyfile: $CF"

if grep -q "added by How Well Are We Doing" "$CF"; then
  ok "Site block already present"
else
  BAK="$CF.bak.$(date +%Y%m%d%H%M%S)"
  cp -p "$CF" "$BAK"
  WWW_BLOCK=""
  [ "$(tr -cd '.' <<<"$DOMAIN" | wc -c)" = 1 ] && WWW_BLOCK="
www.$DOMAIN {
	redir https://$DOMAIN{uri} permanent
}"
  # Append (never rewrite) so a single-file bind mount keeps working
  cat >> "$CF" <<EOF

# ---- $DOMAIN: added by How Well Are We Doing? (deploy/connect-docker-caddy.sh) ----
$DOMAIN {
	request_body {
		max_size 25MB
	}
	reverse_proxy $BRIDGE_IP:$PORT {
		flush_interval -1
	}
}$WWW_BLOCK
# ---- end $DOMAIN ----
EOF
  ok "Site block added (backup: $BAK)"
fi

say "Validating and reloading Caddy"
if docker exec "$CONTAINER" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  docker exec "$CONTAINER" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    && ok "Caddy reloaded" || die "Caddy reload failed. Check: docker logs $CONTAINER --tail 30"
else
  docker exec "$CONTAINER" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -5 || true
  if [ -n "${BAK:-}" ]; then cat "$BAK" > "$CF"; warn "Restored the original Caddyfile."; fi
  die "Caddy rejected the new config. Your other site is unchanged."
fi

say "Waiting for the HTTPS certificate (up to a minute)"
for _ in $(seq 1 20); do
  if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then ok "HTTPS is working: https://$DOMAIN"; break; fi
  sleep 3
done
curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1 || warn "Not answering over HTTPS yet. Check: docker logs $CONTAINER --tail 40 | grep -i $DOMAIN"

echo
warn "Note for the vicisrota project: its Caddyfile ($CF) now has an extra block for $DOMAIN.
    If that Caddyfile is in vicisrota's git repository, commit this change there too,
    so a future vicisrota deploy doesn't remove it."
