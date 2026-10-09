#!/usr/bin/env bash
#
# Evalu8 Compass — encrypted backups (local + off-site)
# ------------------------------------------------------------
#   bash deploy/backup.sh run              make a backup now (the daily cron job runs this)
#   bash deploy/backup.sh setup            install rclone and choose where off-site copies go
#   bash deploy/backup.sh list             show local and off-site backups
#   bash deploy/backup.sh restore <file>   restore data from a backup (local file or off-site name)
#   bash deploy/backup.sh test             back up, then decrypt the result to prove it can be restored
#
# What's backed up: the app's data folder (workshops, access codes, superadmin,
# audit log, signing key) and its .env settings file. Everything is encrypted
# with AES-256 using a passphrase kept in /root/.hwwd-backup-passphrase.
# KEEP A COPY OF THAT PASSPHRASE IN YOUR PASSWORD MANAGER: without it, an
# off-site backup can't be restored if the server is lost.
#
# Off-site copies go to any rclone remote named in /etc/hwwd/backup.conf
# (Backblaze B2, Google Drive, OneDrive, Dropbox, S3, another server by SFTP...).
set -euo pipefail

APP_DIR="${HWWD_APP_DIR:-/opt/hwwd}"
CONF="${HWWD_BACKUP_CONF:-/etc/hwwd/backup.conf}"
PASSFILE="${HWWD_BACKUP_PASSFILE:-/root/.hwwd-backup-passphrase}"
LOCAL_DIR="${HWWD_BACKUP_DIR:-/var/backups/hwwd}"
KEEP_LOCAL_DAYS=14
KEEP_REMOTE_DAYS=90
REMOTE=""; REMOTE_PATH="evalu8compass-backups"
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m !!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mERR\033[0m %s\n' "$*" >&2; exit 1; }

ensure_passphrase() {
  if [ ! -s "$PASSFILE" ]; then
    umask 077
    openssl rand -base64 33 | tr -d '\n=' > "$PASSFILE"
    warn "Created a new backup passphrase in $PASSFILE.
    Copy it into your password manager now. Without it an off-site backup can't be restored:
      $(cat "$PASSFILE")"
  fi
}

run_backup() {
  ensure_passphrase
  mkdir -p "$LOCAL_DIR"; chmod 700 "$LOCAL_DIR"
  local stamp file tmp
  stamp="$(date +%Y-%m-%d_%H%M)"
  file="$LOCAL_DIR/evalu8compass-$stamp.tar.gz.enc"
  tmp="$(mktemp)"
  # data/ plus settings; the passphrase file itself is never included
  local items=(data); [ -f "$APP_DIR/.env" ] && items+=(.env)
  tar -czf "$tmp" -C "$APP_DIR" "${items[@]}" 2>/dev/null
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in "$tmp" -out "$file" -pass "file:$PASSFILE"
  rm -f "$tmp"; chmod 600 "$file"
  ok "Encrypted backup: $file ($(du -h "$file" | cut -f1))"
  find "$LOCAL_DIR" -name 'evalu8compass-*.tar.gz.enc' -mtime +"$KEEP_LOCAL_DAYS" -delete
  # older unencrypted backups from earlier versions
  find "$LOCAL_DIR" -name 'data-*.tgz' -delete 2>/dev/null || true

  if [ -n "$REMOTE" ]; then
    command -v rclone >/dev/null || { warn "rclone isn't installed, so no off-site copy was made. Run: bash $0 setup"; return 1; }
    if rclone copy "$file" "$REMOTE:$REMOTE_PATH/" --quiet; then
      ok "Off-site copy: $REMOTE:$REMOTE_PATH/$(basename "$file")"
      rclone delete "$REMOTE:$REMOTE_PATH/" --min-age "${KEEP_REMOTE_DAYS}d" --include 'evalu8compass-*.tar.gz.enc' --quiet || true
    else
      warn "Off-site copy FAILED. The local backup is fine. Check: rclone lsd $REMOTE:"; return 1
    fi
  else
    warn "No off-site destination yet, so this backup is only on this server. Run: bash $0 setup"
  fi
}

setup() {
  [ "$(id -u)" = 0 ] || die "Run as root."
  ensure_passphrase
  if ! command -v rclone >/dev/null; then
    say "Installing rclone (copies files to cloud storage)"
    if command -v apt-get >/dev/null; then apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq rclone >/dev/null
    else curl -fsSL https://rclone.org/install.sh | bash; fi
  fi
  ok "rclone $(rclone version 2>/dev/null | head -1 | awk '{print $2}')"
  cat <<'EOF'

Next, rclone will ask you to add a "remote" (where backups go). Recommended for a server:

  Backblaze B2 (free up to 10 GB)
    1. Sign up at backblaze.com, create a private bucket, e.g. evalu8compass-backups
    2. Create an application key limited to that bucket
    3. In rclone choose:  n (new remote) → name: offsite → storage: b2
       → paste the keyID and applicationKey → accept the defaults

  Other options work too (Google Drive, OneDrive, Dropbox, S3, SFTP to another server).
  For Google Drive or OneDrive on a server, rclone explains how to authorise from your own computer.

EOF
  rclone config
  local remotes; remotes="$(rclone listremotes | tr -d ':' | tr '\n' ' ')"
  [ -n "$remotes" ] || die "No remote was added. Run setup again when you're ready."
  local pick="${remotes%% *}"
  if [ "$(wc -w <<<"$remotes")" -gt 1 ]; then read -rp "Which remote should backups go to? ($remotes) " pick; fi
  read -rp "Folder or bucket path on $pick [${REMOTE_PATH}]: " p; p="${p:-$REMOTE_PATH}"
  mkdir -p "$(dirname "$CONF")"
  printf 'REMOTE=%q\nREMOTE_PATH=%q\n' "$pick" "$p" > "$CONF"; chmod 600 "$CONF"
  ok "Backups will be copied to $pick:$p"
  REMOTE="$pick"; REMOTE_PATH="$p"
  say "Making a first backup and checking it can be restored"
  test_backup
}

list() {
  say "Local backups ($LOCAL_DIR)"
  ls -lh "$LOCAL_DIR"/evalu8compass-*.tar.gz.enc 2>/dev/null | awk '{print "   " $5 "  " $9}' || echo "   none"
  if [ -n "$REMOTE" ] && command -v rclone >/dev/null; then
    say "Off-site backups ($REMOTE:$REMOTE_PATH)"
    rclone lsl "$REMOTE:$REMOTE_PATH/" --include 'evalu8compass-*.tar.gz.enc' 2>/dev/null | sed 's/^/   /' || echo "   couldn't list"
  else warn "No off-site destination configured."; fi
}

decrypt_to() { # decrypt_to <encrypted file> <output tar.gz>
  [ -s "$PASSFILE" ] || die "No passphrase in $PASSFILE. Put your saved passphrase in that file (chmod 600) and try again."
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in "$1" -out "$2" -pass "file:$PASSFILE" || die "Couldn't decrypt $1. Is the passphrase right?"
}

test_backup() {
  run_backup || true
  local latest tmp; latest="$(ls -t "$LOCAL_DIR"/evalu8compass-*.tar.gz.enc | head -1)"
  tmp="$(mktemp)"; decrypt_to "$latest" "$tmp"
  local n; n="$(tar -tzf "$tmp" | grep -c . || true)"
  rm -f "$tmp"
  [ "$n" -gt 0 ] && ok "Restore check passed: $n files can be recovered from $(basename "$latest")" || die "Restore check failed."
}

restore() {
  [ "$(id -u)" = 0 ] || die "Run as root."
  local src="${1:-}"; [ -n "$src" ] || die "Say which backup, e.g.: bash $0 restore $LOCAL_DIR/evalu8compass-2026-10-09_0300.tar.gz.enc"
  local file="$src"
  if [ ! -f "$file" ]; then
    [ -n "$REMOTE" ] || die "$src not found locally and no off-site destination is configured."
    file="$(mktemp -d)/$(basename "$src")"
    rclone copyto "$REMOTE:$REMOTE_PATH/$(basename "$src")" "$file" || die "Couldn't download $src from $REMOTE."
  fi
  local tmp; tmp="$(mktemp)"; decrypt_to "$file" "$tmp"
  say "This replaces the current data and settings in $APP_DIR."
  read -rp "Type RESTORE to continue: " c; [ "$c" = "RESTORE" ] || die "Cancelled. Nothing changed."
  systemctl stop hwwd 2>/dev/null || true
  [ -d "$APP_DIR/data" ] && mv "$APP_DIR/data" "$APP_DIR/data.before-restore.$(date +%s)"
  tar -xzf "$tmp" -C "$APP_DIR"; rm -f "$tmp"
  if id hwwd >/dev/null 2>&1; then
    chown -R hwwd:hwwd "$APP_DIR/data"
    [ -f "$APP_DIR/.env" ] && chown root:hwwd "$APP_DIR/.env" && chmod 640 "$APP_DIR/.env"
  fi
  systemctl start hwwd 2>/dev/null || true
  ok "Restored. The previous data was kept in $APP_DIR/data.before-restore.*"
}

case "${1:-run}" in
  run) run_backup ;;
  setup) setup ;;
  list) list ;;
  restore) restore "${2:-}" ;;
  test) test_backup ;;
  *) sed -n '3,9p' "$0" ;;
esac
