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
| Update to a new version | `cd` into your copy of the repository, `git pull`, then `bash deploy/install.sh yourdomain` again (settings and data are kept) |
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

## Policy pages (privacy, terms, DPIA, accessibility)

The privacy notice, terms, DPIA information and accessibility statement are at
`/privacy.html`, `/terms.html`, `/dpia.html` and `/accessibility.html`. Details that
are specific to you come from `/opt/hwwd/.env`. Add these lines and fill them in:

```
OPERATOR_NAME=Your name or company
OPERATOR_ADDRESS=Registered office (optional)
ICO_REGISTRATION=ZB123456
HOSTING_REGION=the United Kingdom
BACKUP_PROVIDER=Backblaze (EU region)
EMAIL_PROVIDER=Hostinger
SCHOOL_RETENTION_DAYS=365
```

Then run `systemctl restart hwwd`. Any you leave blank use neutral wording.
Ask a data protection adviser to review the pages before you sign up schools.

## Sign-up, email and invoices

Schools sign up at `/signup.html` and get their access code by email. The first term is free (until
the end of the term they join in; join after half-term and the next term is free too). When it ends
access carries on for 14 more days, then the code pauses (work kept). Subscribing (from the dashboard,
or at `/subscribe.html` with the code) keeps or restores access at once for 12 months and emails an
invoice payable within 30 days. Once you mark it paid, the school's dashboard shows "Subscribed and
paid". When a paid year ends, access carries on for 30 days while the school renews; the new year
starts on the old end date. Reminder emails go out two weeks before a free term ends, when it ends,
when access pauses, 30 days before renewal, a week after an invoice falls overdue, when a paid year
ends, and when access pauses after it.

1. **A mailbox to send from.** In hPanel, create `support@evalu8compass.app` under Emails (if you
   haven't already). Hostinger sets up the DNS records (SPF and DKIM) that stop your emails going to
   junk when the domain's DNS is at Hostinger. Check under Emails → your domain → DNS settings.
2. **Add these lines** to `/opt/hwwd/.env` with `nano /opt/hwwd/.env` (use the mailbox's real password; never paste it into chat):

```
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=support@evalu8compass.app
SMTP_PASS=the-mailbox-password
MAIL_FROM=Evalu8 Compass <support@evalu8compass.app>
ADMIN_EMAIL=your-own@email.address
OPERATOR_NAME=Your name or company
OPERATOR_ADDRESS=Your postal address, shown on invoices
BANK_ACCOUNT_NAME=Name on the account
BANK_SORT_CODE=12-34-56
BANK_ACCOUNT_NUMBER=12345678
```

3. `systemctl restart hwwd`, then sign up a test school at `/signup.html` with your own email address.
   The code should arrive in a minute. In the admin console, **Free terms and subscriptions** shows it.

Leave `VAT_NUMBER` blank until you're VAT registered. The pricing page and invoices then say no VAT
is charged. Once it's set, invoices add VAT at `VAT_RATE` (20%).

**In the admin console:** when a payment reaches your bank, click **Mark paid** (the school gets a
receipt). **Send invoice** sends or resends it. **Cancel** ends a subscription now. **Free term**
changes the last free day. Codes you made by hand can be moved onto a plan with **Put on a plan**.
Invoices are numbered EC-year-0001 and kept in `data/invoices.jsonl` (keep them for six years).
Academy trusts send an enquiry instead of signing up: you get an email, and it's listed in the console.
For a trust, create each school's code by hand under **Create an access code** and agree the price directly.
To pause a school whose invoice is long overdue, **Revoke** its code (work is kept); **Reactivate** once it pays.

If codes don't arrive, check `journalctl -u hwwd -n 50` for "Sign-up email failed". The usual causes are a
wrong mailbox password, or the VPS blocking outgoing port 465 (try `SMTP_PORT=587`).

## Consultant register

Consultants and SIPs apply at `/for-consultants.html`. You get an email for each application.
In the admin console, open **Consultants**:

1. Contact the consultant to see their enhanced DBS certificate, then check its status on the DBS
   Update Service (gov.uk "Check a DBS certificate", with their consent). Check the teacher prohibition
   list through the Teaching Regulation Agency, their insurance certificate, two references and ID.
2. Record each check with the date you made it. Don't record certificate details: a short note such
   as "certificate seen, status current" is enough.
3. **Approve**: the £49 listing invoice is emailed. When it's paid, click **Listing fee paid: go live**.
4. A month before each anniversary the consultant is emailed the £18 annual check invoice. Recheck the
   DBS status and insurance, record them, then click **Annual check done**.

Listings hide themselves if insurance expires or the annual check is over 30 days late. Changes a
consultant makes after approval wait for you under **Needs action**. **Email their private link**
sends a new link and stops the old one working. Only signed-in schools can search the register.

Postcode distances use postcodes.io (free, no key). Only postcodes are sent; consultants' locations
are stored as the postcode district's centre.

## AI allowance

Each school can make `AI_MONTHLY_REQUESTS` AI requests a month (default 50), counted in UK time and
reset on the 1st. Workshop AI counts against the school that started the workshop. Schools see how
much is left next to the AI switch; when it runs out they get the built-in suggestions instead.
In the admin console, **AI allowance** next to a school changes its limit (a number, 0 to switch AI
off, `unlimited`, or blank for the default). Add `AI_PRICE_INPUT_PER_MTOK` and
`AI_PRICE_OUTPUT_PER_MTOK` (from Anthropic's pricing page for your model) to see estimated costs.

**Extra AI requests.** When a school has 10 or fewer AI requests left, a **Buy more AI requests** link
appears next to its allowance. The school chooses a pack (set by `AI_TOPUP_PACKS`, default 50 for £10,
150 for £25, 400 for £60) and gives invoice details. You get an email; in the admin console under
**Free terms and subscriptions → AI top-ups**, click **Approve and add** (you can change the number
of requests or the price), and the requests are added and the invoice emailed. Extra requests are used
after the monthly allowance and don't expire at the month's end. **Extra AI requests** next to a school
adds or removes them by hand.

## AI quality check

Signed in as superadmin, open **AI quality check** (`/admin-eval.html`). Run the AI on the reference
Ofsted reports, or any report PDF from files.ofsted.gov.uk, and see how its reading compares with
what the report says. Then record your own verdict. Each check uses three AI requests, charged to the
admin account, not a school. Results are kept in `data/ai-evals.jsonl` (no report text).

## Saved school work

Each school's checklist, action plan and snapshots live in `/opt/hwwd/data/schools/<code id>/`,
and the daily encrypted backup covers them. Saved work is deleted automatically
`SCHOOL_RETENTION_DAYS` after a school's code is revoked or expires. To delete a school's data
straight away (for example when a school asks), use **Delete data** next to its code in the admin console. To remove a school altogether (its code, contact and subscription details, saved work and workshops), use **Delete school** and type the school's name to confirm. Invoices already issued are kept for your accounts.

## Security

- Code belongs to root; the app runs as its own restricted user and can only write to its data folder.
- Every page sends strict browser security headers: scripts only from this site, no embedding in other sites, no camera/microphone/location access.
- Keep the server patched: Ubuntu's `unattended-upgrades` installs security updates automatically (`apt install unattended-upgrades` if it isn't on already).

## Troubleshooting
- **502 Bad Gateway**: the app isn't running. `journalctl -u hwwd -n 50` shows why.
- **HTTPS failed**: usually DNS isn't pointing at the server yet. Fix the A record, then `certbot --nginx -d review.yourdomain.co.uk`.
- **"The AI isn't set up on this server"**: add `ANTHROPIC_API_KEY` to `/opt/hwwd/.env` and restart.
- **Cloudflare in front**: set SSL mode to Full (strict) after HTTPS is working on the server.
