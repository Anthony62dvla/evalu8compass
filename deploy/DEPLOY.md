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

## Troubleshooting
- **502 Bad Gateway**: the app isn't running. `journalctl -u hwwd -n 50` shows why.
- **HTTPS failed**: usually DNS isn't pointing at the server yet. Fix the A record, then `certbot --nginx -d review.yourdomain.co.uk`.
- **"The AI isn't set up on this server"**: add `ANTHROPIC_API_KEY` to `/opt/hwwd/.env` and restart.
- **Cloudflare in front**: set SSL mode to Full (strict) after HTTPS is working on the server.
