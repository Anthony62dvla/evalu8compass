#!/usr/bin/env bash
#
# How Well Are We Doing? — VPS installer / updater
# ------------------------------------------------------------
# Usage (as root, from the unzipped project folder):
#   sudo bash deploy/install.sh review.yourdomain.co.uk [--email you@school.org] [--port 3100] [--yes] [--dry-run]
#
# What it does (safe to re-run; re-running is also how you update):
#   1. Finds Node 18+ (including root's nvm install) and copies the node binary
#      to /opt/hwwd/runtime so the app never needs root.
#   2. Creates a locked-down system user "hwwd".
#   3. Copies the app to /opt/hwwd, keeping any existing .env and data/.
#   4. Creates .env (asks for your Anthropic API key once; leave blank to add later).
#   5. Installs and starts a systemd service "hwwd" bound to 127.0.0.1 only.
#   6. Adds a site for your domain to nginx or Caddy (whichever is running),
#      without touching your other sites, and sets up HTTPS where it can.
#      If neither is installed and ports 80/443 are free, offers to install Caddy.
#   7. Adds a daily backup of workshop data to /var/backups/hwwd (14 days kept).
#
set -euo pipefail

APP=hwwd
APP_DIR=/opt/hwwd
APP_USER=hwwd
PORT=3100
EMAIL=""
DOMAIN=""
DRY=0
YES=0
FRESH_CADDY=0
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERR\033[0m %s\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then printf '   [dry-run] %s\n' "$*"; else eval "$*"; fi; }
write_file() { # write_file <path> <mode>  (content on stdin)
  local path="$1" mode="$2" tmp; tmp="$(mktemp)"; cat > "$tmp"
  if [ "$DRY" = 1 ]; then printf '   [dry-run] write %s:\n' "$path"; sed 's/^/      | /' "$tmp"; rm -f "$tmp"; return; fi
  install -m "$mode" "$tmp" "$path"; rm -f "$tmp"
}

# ---------- arguments ----------
while [ $# -gt 0 ]; do
  case "$1" in
    --email) EMAIL="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    -*) die "Unknown option $1" ;;
    *) DOMAIN="$1"; shift ;;
  esac
done
[ -n "$DOMAIN" ] || die "Give the domain, e.g.  sudo bash deploy/install.sh review.yourdomain.co.uk"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "\"$DOMAIN\" doesn't look like a domain name."
[[ "$PORT" =~ ^[0-9]{4,5}$ ]] || die "Port must be a number like 3100."
[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ] || die "Run as root (sudo)."
[ -f "$SRC_DIR/server.js" ] || die "Run this from the unzipped project folder (server.js not found in $SRC_DIR)."
[ "$DRY" = 1 ] || command -v systemctl >/dev/null || die "systemd is required."

# ---------- 1. Node ----------
say "Finding Node.js"
NODE_BIN=""
if command -v node >/dev/null 2>&1; then NODE_BIN="$(command -v node)"; fi
if [ -z "$NODE_BIN" ] && [ -s /root/.nvm/nvm.sh ]; then
  # shellcheck disable=SC1091
  NODE_BIN="$(bash -c 'source /root/.nvm/nvm.sh >/dev/null 2>&1; nvm which default 2>/dev/null || command -v node' || true)"
fi
[ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ] || die "Node.js not found. Install Node 18 or later first."
NODE_VER="$("$NODE_BIN" -v)"
NODE_MAJOR="${NODE_VER#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
[ "$NODE_MAJOR" -ge 18 ] || die "Node $NODE_VER is too old; 18 or later is needed."
ok "Using $NODE_BIN ($NODE_VER)"

# ---------- port check ----------
if command -v ss >/dev/null && ss -ltnH "sport = :$PORT" 2>/dev/null | grep -q . ; then
  if ! systemctl is-active --quiet "$APP" 2>/dev/null; then
    die "Port $PORT is already used by something else (maybe your other project). Re-run with --port 3200 or another free port."
  fi
fi

# ---------- domain checks (before changing anything) ----------
DOMAIN_RE="${DOMAIN//./\\.}"
WWW=""
# For a bare domain (example.app), also serve www.example.app if its DNS exists
if [ "$(tr -cd '.' <<<"$DOMAIN" | wc -c)" = 1 ] && getent hosts "www.$DOMAIN" >/dev/null 2>&1; then WWW="www.$DOMAIN"; fi
NAMES="$DOMAIN${WWW:+ $WWW}"
say "Checking no other site already uses $NAMES"
CONFLICT=""
for d in /etc/nginx/sites-enabled /etc/nginx/conf.d; do
  [ -d "$d" ] || continue
  for f in $(grep -rlE "server_name[^;]*[[:space:]](www\.)?$DOMAIN_RE([[:space:];]|$)" "$d" 2>/dev/null || true); do
    case "$(basename "$f")" in "$APP.conf") ;; *) CONFLICT="$CONFLICT $f" ;; esac
  done
done
if [ -f /etc/caddy/Caddyfile ] && grep -qE "(^|[[:space:],])(www\.)?$DOMAIN_RE([[:space:],{]|$)" /etc/caddy/Caddyfile \
   && ! grep -q "How Well Are We Doing" /etc/caddy/Caddyfile; then CONFLICT="$CONFLICT /etc/caddy/Caddyfile"; fi
if [ -n "$CONFLICT" ]; then
  die "$DOMAIN is already used by another site on this server:$CONFLICT
    Nothing has been changed. Use a subdomain instead, e.g.
      bash deploy/install.sh review.$DOMAIN --email you@example.org
    (add a DNS A record for it pointing at this server first)."
fi
ok "No conflicts"

# ---------- 2. user ----------
say "Creating system user $APP_USER"
if id "$APP_USER" >/dev/null 2>&1; then ok "User exists"
else run "useradd --system --home-dir $APP_DIR --shell /usr/sbin/nologin $APP_USER"; ok "User created"; fi

# ---------- 3. app files ----------
say "Copying the app to $APP_DIR"
run "mkdir -p $APP_DIR/runtime $APP_DIR/data/sessions"
if command -v rsync >/dev/null; then
  run "rsync -a --delete --exclude '.env' --exclude 'data/' --exclude 'runtime/' --exclude 'dist/' --exclude 'node_modules/' --exclude '.git/' '$SRC_DIR/' '$APP_DIR/'"
else
  run "tar -C '$SRC_DIR' --exclude=.env --exclude=data --exclude=runtime --exclude=dist --exclude=node_modules --exclude=.git -cf - . | tar -C '$APP_DIR' -xf -"
fi
run "install -m 755 '$NODE_BIN' '$APP_DIR/runtime/node'"
ok "App and Node runtime in place"

# ---------- 4. .env ----------
say "Configuring settings"
if [ -f "$APP_DIR/.env" ]; then
  ok "Keeping existing $APP_DIR/.env"
  run "sed -i -E 's/^PORT=.*/PORT=$PORT/; s/^TRUST_PROXY=[^ ]*/TRUST_PROXY=1/' '$APP_DIR/.env'"   # HOST is kept as you set it
else
  KEY="${ANTHROPIC_API_KEY:-}"
  if [ -z "$KEY" ] && [ -t 0 ] && [ "$DRY" = 0 ]; then
    printf 'Anthropic API key for the AI inspector (input hidden; press Enter to add it later): '
    read -rs KEY; echo
  fi
  sed -e "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$KEY|" -e "s|^PORT=.*|PORT=$PORT|" \
      -e "s|^HOST=[^ ]*|HOST=127.0.0.1|" -e "s|^TRUST_PROXY=[^ ]*|TRUST_PROXY=1|" \
      "$SRC_DIR/.env.example" | write_file "$APP_DIR/.env" 600
  [ -n "$KEY" ] && ok "API key saved" || warn "No API key yet. Add it later to $APP_DIR/.env, then: systemctl restart $APP"
fi
# Code is owned by root (the app can read but not change it); only data/ belongs to the app user.
# The guard and backup scripts run as root, so the app must never be able to edit them.
run "chown -R root:$APP_USER $APP_DIR && chmod -R g-w,o-rwx $APP_DIR && chmod 750 $APP_DIR"
run "chown -R $APP_USER:$APP_USER $APP_DIR/data && chmod 750 $APP_DIR/data"
run "[ -f $APP_DIR/.env ] && chown root:$APP_USER $APP_DIR/.env && chmod 640 $APP_DIR/.env || true"

# ---------- 5. systemd ----------
say "Installing the $APP service"
write_file "/etc/systemd/system/$APP.service" 644 <<EOF
[Unit]
Description=How Well Are We Doing? (Ofsted self-assessment and staff workshops)
After=network-online.target$(systemctl list-unit-files docker.service >/dev/null 2>&1 && echo " docker.service")
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/runtime/node $APP_DIR/server.js
Restart=on-failure
RestartSec=3
Environment=NODE_ENV=production
# Hardening: the app can only write to its own data folder
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR/data
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
MemoryMax=400M

[Install]
WantedBy=multi-user.target
EOF
run "systemctl daemon-reload"
run "systemctl enable $APP >/dev/null 2>&1"
run "systemctl restart $APP"

APP_HOST="$(grep -E '^HOST=' "$APP_DIR/.env" 2>/dev/null | head -1 | sed -E 's/^HOST=([^ ]*).*/\1/' || true)"
case "$APP_HOST" in ""|0.0.0.0) APP_HOST=127.0.0.1 ;; esac
if [ "$DRY" = 0 ]; then
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS "http://$APP_HOST:$PORT/api/health" >/dev/null 2>&1; then break; fi; sleep 1
  done
  if curl -fsS "http://$APP_HOST:$PORT/api/health" >/dev/null 2>&1; then
    ok "Service running on $APP_HOST:$PORT: $(curl -fsS "http://$APP_HOST:$PORT/api/health")"
  else
    journalctl -u "$APP" -n 30 --no-pager || true
    die "The service didn't start. The log is above."
  fi
fi

# ---------- school access codes ----------
say "School access codes"
write_file /usr/local/bin/hwwd-access 755 <<EOF
#!/bin/sh
# Manage Evalu8 Compass school access codes:  hwwd-access add "School name" | list | revoke <id>
[ "\$(id -u)" = 0 ] || { echo "Run as root (sudo hwwd-access ...)"; exit 1; }
exec runuser -u $APP_USER -- $APP_DIR/runtime/node $APP_DIR/scripts/access.js "\$@"
EOF
# Only on a first install: no codes yet and no superadmin (checked from the files, so re-running never adds another)
if [ "$DRY" = 0 ] && [ ! -f "$APP_DIR/data/admin.json" ] && ! grep -q '"hash"' "$APP_DIR/data/access.json" 2>/dev/null; then
  say "Creating your first access code"
  /usr/local/bin/hwwd-access add "Administrator"
  warn "Keep that code safe: from now on the checklist, starting workshops and AI need an access code.
    Create one for each school with:   hwwd-access add \"School name\"
    See all codes:                     hwwd-access list"
else
  ok "Manage codes with: hwwd-access add \"School name\" | hwwd-access list | hwwd-access revoke <id>"
fi
if [ "$DRY" = 0 ] && [ ! -f "$APP_DIR/data/admin.json" ]; then
  warn "Set up your superadmin console (password + authenticator app) with:   hwwd-access admin
    then sign in at https://$DOMAIN/admin.html"
fi

# ---------- 6. web server ----------
say "Setting up $DOMAIN"
DNS_OK=1
DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)"
MY_IP="$(curl -4 -fsS --max-time 5 https://api.ipify.org 2>/dev/null || curl -4 -fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)"
if [ -z "$DNS_IP" ]; then
  DNS_OK=0; warn "DNS for $DOMAIN isn't resolving yet. Add an A record pointing at this server${MY_IP:+ ($MY_IP)}; HTTPS needs it."
elif [ -n "$MY_IP" ] && [ "$DNS_IP" != "$MY_IP" ]; then
  DNS_OK=0; warn "$DOMAIN points to $DNS_IP, but this server is $MY_IP.
    Change the domain's A record to $MY_IP at your registrar (and delete any AAAA record unless this server has IPv6),
    wait a few minutes, then re-run this script to switch on HTTPS."
else ok "DNS: $DOMAIN → $DNS_IP${MY_IP:+ (this server)}"; fi

WEB=""
if systemctl is-active --quiet caddy 2>/dev/null; then WEB=caddy
elif systemctl is-active --quiet nginx 2>/dev/null; then WEB=nginx
elif command -v nginx >/dev/null; then WEB=nginx
elif command -v caddy >/dev/null; then WEB=caddy; fi

if [ -z "$WEB" ]; then
  say "No web server found. Checking the web ports (80 and 443)"
  BUSY="$(ss -ltnpH 2>/dev/null | awk '$4 ~ /:(80|443)$/' || true)"
  if [ -n "$BUSY" ]; then
    warn "Something else is already using port 80 or 443, so nothing has been changed:"
    printf '%s\n' "$BUSY" | sed 's/^/      /'
    command -v docker >/dev/null && docker ps --format '      docker: {{.Names}} ({{.Image}}) {{.Ports}}' 2>/dev/null | grep -E ':(80|443)->' || true
    CADDY_CT="$(command -v docker >/dev/null && docker ps --format '{{.Names}} {{.Image}} {{.Ports}}' 2>/dev/null | awk '$2 ~ /caddy/ && /:443->/ {print $1; exit}' || true)"
    if [ -n "$CADDY_CT" ]; then
      warn "That's a Caddy container ($CADDY_CT). To add this site to it, run:
      bash $SRC_DIR/deploy/connect-docker-caddy.sh $CADDY_CT $DOMAIN"
    else
      warn "That's probably how your other project is served. Add this site to that proxy, pointing at this app (see README section 4.3)."
    fi
  elif ! command -v apt-get >/dev/null; then
    warn "Ports 80 and 443 are free, but this isn't a Debian/Ubuntu server, so install Caddy yourself (caddyserver.com/docs/install) and re-run."
  else
    ANSWER=y
    if [ "$YES" = 0 ] && [ -t 0 ] && [ "$DRY" = 0 ]; then
      printf 'Ports 80 and 443 are free. Install Caddy to serve %s with automatic HTTPS? [Y/n] ' "$DOMAIN"
      read -r ANSWER; ANSWER="${ANSWER:-y}"
    fi
    case "$ANSWER" in
      y|Y|yes|Yes)
        say "Installing Caddy (official package)"
        run "apt-get update -qq"
        run "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null"
        run "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg"
        run "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list"
        run "chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list"
        run "apt-get update -qq"
        run "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy >/dev/null"
        if [ "$DRY" = 1 ] || command -v caddy >/dev/null; then ok "Caddy installed"; WEB=caddy; FRESH_CADDY=1
        else warn "Caddy didn't install. Install it by hand (caddyserver.com/docs/install) and re-run."; fi
        ;;
      *) warn "Skipped. The app is running on 127.0.0.1:$PORT; add a web server in front of it and re-run." ;;
    esac
  fi
  if [ "$WEB" = caddy ] && command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
    run "ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null"; ok "Firewall: opened ports 80 and 443"
  fi
fi

case "$WEB" in
  nginx)
    if [ -d /etc/nginx/sites-available ]; then CONF=/etc/nginx/sites-available/$APP.conf; LINK=/etc/nginx/sites-enabled/$APP.conf
    else CONF=/etc/nginx/conf.d/$APP.conf; LINK=""; fi
    if [ -f "$CONF" ] && grep -q "managed-by-certbot\|listen 443" "$CONF"; then
      ok "Keeping existing nginx site (already has HTTPS): $CONF"
    else
      write_file "$CONF" 644 <<EOF
# How Well Are We Doing? — added by deploy/install.sh
server {
    listen 80;
    listen [::]:80;
    server_name $NAMES;
    client_max_body_size 25m;            # Ofsted report PDFs

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection "";
        proxy_buffering off;             # live workshop updates (Server-Sent Events)
        proxy_cache off;
        proxy_read_timeout 1h;
    }
}
EOF
      [ -n "$LINK" ] && run "ln -sf '$CONF' '$LINK'"
    fi
    if [ "$DRY" = 1 ] || nginx -t >/dev/null 2>&1; then run "systemctl reload nginx"; ok "nginx site added"
    else nginx -t || true; die "nginx config test failed; your other sites are unchanged. Fix the error above and re-run."; fi
    if [ "$DNS_OK" = 0 ]; then
      warn "Skipping HTTPS until DNS points at this server."
    elif command -v certbot >/dev/null; then
      if [ -n "$EMAIL" ]; then
        run "certbot --nginx -d '$DOMAIN'${WWW:+ -d '$WWW'} --non-interactive --agree-tos -m '$EMAIL' --redirect" && ok "HTTPS enabled" || warn "certbot didn't finish. Run: certbot --nginx -d $DOMAIN"
      else warn "For HTTPS run:  certbot --nginx -d $DOMAIN   (or re-run this script with --email you@example.org)"; fi
    else warn "certbot isn't installed. Install it (apt install certbot python3-certbot-nginx), then run: certbot --nginx -d $DOMAIN"; fi
    ;;
  caddy)
    CF=/etc/caddy/Caddyfile
    if [ "$FRESH_CADDY" = 1 ] && [ "$DRY" = 0 ] && grep -q "/usr/share/caddy" "$CF" 2>/dev/null; then
      mv "$CF" "$CF.default.bak"; printf '# Caddy configuration (default saved as Caddyfile.default.bak)\n' > "$CF"
    fi
    if grep -q "^$DOMAIN {" "$CF" 2>/dev/null; then ok "Caddy already has a block for $DOMAIN"
    else
      run "cp '$CF' '$CF.bak.$(date +%Y%m%d%H%M%S)'"
      if [ "$DRY" = 1 ]; then printf '   [dry-run] append site block for %s to %s\n' "$DOMAIN" "$CF"
      else cat >> "$CF" <<EOF

# How Well Are We Doing? — added by deploy/install.sh
$DOMAIN {
    request_body {
        max_size 25MB
    }
    reverse_proxy 127.0.0.1:$PORT {
        flush_interval -1
    }
}
EOF
        if [ -n "$WWW" ]; then printf '\n%s {\n    redir https://%s{uri} permanent\n}\n' "$WWW" "$DOMAIN" >> "$CF"; fi
      fi
    fi
    if [ "$DRY" = 1 ] || caddy validate --config "$CF" >/dev/null 2>&1; then
      run "systemctl enable caddy >/dev/null 2>&1; systemctl reload caddy 2>/dev/null || systemctl restart caddy"; ok "Caddy site added"
    else caddy validate --config "$CF" || true; die "Caddy config check failed. A backup of your Caddyfile is next to it."; fi
    if [ "$DRY" = 0 ] && [ "$DNS_OK" = 1 ]; then
      say "Waiting for the HTTPS certificate (up to a minute)"
      HTTPS_OK=0
      for _ in $(seq 1 20); do
        if curl -fsS --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then HTTPS_OK=1; break; fi; sleep 3
      done
      if [ "$HTTPS_OK" = 1 ]; then ok "HTTPS is working: https://$DOMAIN"
      else warn "HTTPS isn't answering yet. Check: journalctl -u caddy -n 50 --no-pager   (also check the Hostinger firewall allows ports 80 and 443)"; fi
    elif [ "$DNS_OK" = 0 ]; then warn "Caddy will get the HTTPS certificate automatically once DNS points at this server."; fi
    ;;
  *) ;;  # explained above
esac

# ---------- 7. backups ----------
say "Daily encrypted backups"
write_file /etc/cron.daily/$APP-backup 755 <<EOF
#!/bin/sh
# Evalu8 Compass: daily encrypted backup (local + off-site if configured). Log: /var/log/hwwd-backup.log
exec /bin/bash $APP_DIR/deploy/backup.sh run >> /var/log/hwwd-backup.log 2>&1
EOF
if [ "$DRY" = 0 ] && [ ! -s /root/.hwwd-backup-passphrase ]; then bash "$APP_DIR/deploy/backup.sh" run || true; fi
if [ ! -f /etc/hwwd/backup.conf ]; then
  warn "Backups are only on this server so far. To also copy them off-site (recommended), run:
      bash $APP_DIR/deploy/backup.sh setup"
else ok "Off-site backups configured"; fi

# ---------- 8. self-healing guard ----------
say "Self-healing guard (checks every 5 minutes)"
write_file /etc/systemd/system/$APP-guard.service 644 <<EOF
[Unit]
Description=Evalu8 Compass self-healing guard
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash $APP_DIR/deploy/guard.sh
EOF
write_file /etc/systemd/system/$APP-guard.timer 644 <<EOF
[Unit]
Description=Run the Evalu8 Compass guard every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF
run "systemctl daemon-reload"
run "systemctl enable --now $APP-guard.timer >/dev/null 2>&1"
ok "Guard on. Its log: journalctl -t hwwd-guard"

echo
say "Done"
cat <<EOF
   Checklist:      https://$DOMAIN/
   Staff workshop: https://$DOMAIN/workshop.html   (staff join at https://$DOMAIN/join/CODE)

   Settings:  $APP_DIR/.env          then: systemctl restart $APP
   Logs:      journalctl -u $APP -f
   Update:    cd $SRC_DIR && git pull && bash deploy/install.sh $DOMAIN   (settings and data are kept)
EOF
case "$DOMAIN" in *.app|*.dev|*.page) warn "$DOMAIN is HTTPS-only in every browser (.app/.dev/.page domains): the site won't open until HTTPS is set up." ;; esac
