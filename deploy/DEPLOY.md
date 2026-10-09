# Deploying to your VPS

Tested for a VPS that already runs another project, with Node installed under root's nvm.

## Before you start
1. **Choose a subdomain**, e.g. `review.yourdomain.co.uk`.
2. **Add a DNS A record** for it pointing at the VPS's IP address. (Wait a few minutes for it to work.)
3. Have your **Anthropic API key** ready (console.anthropic.com). You can also add it later.

## Install (about 2 minutes)
From your computer, copy the zip to the server:
```bash
scp how-well-are-we-doing.zip root@YOUR_SERVER_IP:/root/
```
Then on the server, as root:
```bash
cd /root && unzip -o how-well-are-we-doing.zip
cd how-well-are-we-doing
bash deploy/install.sh review.yourdomain.co.uk --email you@yourschool.org
```
`--email` lets it set up HTTPS automatically with certbot (nginx). Caddy does HTTPS on its own.

The installer:
- copies the app to `/opt/hwwd` and runs it as its own user `hwwd` (never root), with its own copy of Node, so your nvm setup and other project are untouched
- runs it on port **3100**, reachable only from the server itself (use `--port 3200` if 3100 is taken; it checks for you)
- adds **one new site** to nginx or Caddy for your subdomain; your other sites aren't changed, and it tests the config before reloading
- backs up workshop data daily to `/var/backups/hwwd`

Try it with `--dry-run` first to see exactly what it will do without changing anything.

## After installing
| Task | Command |
|---|---|
| Check it's running | `systemctl status hwwd` |
| Watch the log | `journalctl -u hwwd -f` |
| Add or change the API key | `nano /opt/hwwd/.env` then `systemctl restart hwwd` |
| Update to a new version | unzip the new zip, `cd` into it, run `bash deploy/install.sh review.yourdomain.co.uk` again (settings and data are kept) |
| Stop / start | `systemctl stop hwwd` / `systemctl start hwwd` |

## Check it works
1. Open `https://review.yourdomain.co.uk/` and you should see the teal checklist.
2. Open `https://review.yourdomain.co.uk/workshop.html`, start a test workshop, and join it from your phone with the code.
3. Tick **Share findings with staff** and check your phone updates within a second or two. If it doesn't, the web server is buffering: make sure the site has `proxy_buffering off` (nginx) or `flush_interval -1` (Caddy).

## Backups

Every night the server makes an **encrypted** backup of the app's data (workshops, access codes, superadmin, audit log) and settings. The first time, the installer creates a backup passphrase and shows it once. **Save it in your password manager**: without it, a backup can't be restored if the server is lost. It's also kept at `/root/.hwwd-backup-passphrase`.

To copy each night's backup **off the server** (recommended), run once:
```bash
bash /opt/hwwd/deploy/backup.sh setup
```
It installs rclone and walks you through adding a destination. Backblaze B2 is the simplest for a server (free up to 10 GB): create a private bucket and an application key, then choose `b2` in rclone and paste the key. Google Drive, OneDrive, Dropbox, S3 or SFTP to another server also work. It finishes by making a backup and proving it can be decrypted.

| Task | Command |
|---|---|
| Back up now | `bash /opt/hwwd/deploy/backup.sh run` |
| See backups | `bash /opt/hwwd/deploy/backup.sh list` |
| Check a backup can be restored | `bash /opt/hwwd/deploy/backup.sh test` |
| Restore (asks you to type RESTORE) | `bash /opt/hwwd/deploy/backup.sh restore <backup file name>` |
| Backup log | `tail /var/log/hwwd-backup.log` |

Local copies are kept for 14 days, off-site copies for 90 days. To restore on a **new** server: install the app, put your saved passphrase in `/root/.hwwd-backup-passphrase` (`chmod 600`), run `backup.sh setup` with the same off-site destination, then `backup.sh restore <name>`.

## Self-healing guard

Every 5 minutes a guard checks the app. If it doesn't answer twice in a row, the guard restarts it. If you use the shared Caddy container (`connect-docker-caddy.sh`) and a deploy of the other project removes evalu8compass.app from its Caddyfile, the guard puts it back. See what it has done with `journalctl -t hwwd-guard`.

## Uptime monitoring (5 minutes to set up)

The guard fixes problems on the server, but it can't tell you if the whole server goes down. For that, use a free outside monitor such as UptimeRobot:

1. Sign up at uptimerobot.com.
2. **Add New Monitor** → type **Keyword**.
3. URL: `https://evalu8compass.app/api/health`, keyword: `"ok":true` (alert when the keyword is *not* found).
4. Interval: 5 minutes. Alert contact: your email (and the mobile app if you want phone alerts).

## Security

- Code belongs to root; the app runs as its own restricted user and can only write to its data folder.
- Every page sends strict browser security headers: scripts only from this site, no embedding in other sites, no camera/microphone/location access.
- Keep the server patched: Ubuntu's `unattended-upgrades` installs security updates automatically (`apt install unattended-upgrades` if it isn't on already).

## Troubleshooting
- **502 Bad Gateway**: the app isn't running. `journalctl -u hwwd -n 50` shows why.
- **HTTPS failed**: usually DNS isn't pointing at the server yet. Fix the A record, then `certbot --nginx -d review.yourdomain.co.uk`.
- **"The AI isn't set up on this server"**: add `ANTHROPIC_API_KEY` to `/opt/hwwd/.env` and restart.
- **Cloudflare in front**: set SSL mode to Full (strict) after HTTPS is working on the server.
