/*
 * Sending email (access codes, invoices, reminders)
 * ------------------------------------------------------------
 * A small SMTP client with no dependencies. Works with Hostinger email
 * (smtp.hostinger.com, port 465, SSL) or any other SMTP provider.
 *
 *   SMTP_HOST, SMTP_PORT (465), SMTP_SECURE (1 = SSL from the start; 0 = plain,
 *   upgraded with STARTTLS when the server offers it), SMTP_USER, SMTP_PASS,
 *   MAIL_FROM ("Evalu8 Compass <support@evalu8compass.app>"), ADMIN_EMAIL.
 *
 * Without SMTP_HOST nothing is sent. With MAIL_OUTBOX=1 (tests, local trials)
 * messages are written to data/outbox.jsonl instead.
 */
const net = require("net");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const OUTBOX = path.join(__dirname, "..", "data", "outbox.jsonl");
const env = k => String(process.env[k] || "").trim();

function configured() { return !!env("SMTP_HOST") || env("MAIL_OUTBOX") === "1"; }
function from() { return env("MAIL_FROM") || (env("SMTP_USER") ? `Evalu8 Compass <${env("SMTP_USER")}>` : "Evalu8 Compass <support@evalu8compass.app>"); }
function adminEmail() { return env("ADMIN_EMAIL") || (from().match(/<([^>]+)>/) || [])[1] || ""; }
const addr = s => { const m = String(s).match(/<([^>]+)>/); return (m ? m[1] : String(s)).trim(); };
const oneLine = s => String(s || "").replace(/[\r\n]+/g, " ").trim();
const validEmail = e => /^[^@\s<>"(),;:]+@[^@\s<>"(),;:]+\.[a-z]{2,}$/i.test(String(e || "").trim()) && String(e).length <= 200;

function encodeHeader(s) {
  s = oneLine(s);
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`;
}
const b64 = s => Buffer.from(s, "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");

/** Build the raw message: plain text plus an optional HTML version. */
function build({ to, subject, text, html, replyTo, cc }) {
  const boundary = "b_" + crypto.randomBytes(12).toString("hex");
  const domain = addr(from()).split("@")[1] || "localhost";
  const head = [
    `From: ${oneLine(from())}`,
    `To: ${[].concat(to).map(oneLine).join(", ")}`,
    cc && [].concat(cc).length ? `Cc: ${[].concat(cc).map(oneLine).join(", ")}` : null,
    replyTo ? `Reply-To: ${oneLine(replyTo)}` : null,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomBytes(12).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
  ].filter(Boolean);
  if (!html) return [...head, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", b64(text)].join("\r\n");
  return [...head, `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", b64(text),
    `--${boundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", b64(html),
    `--${boundary}--`, ""].join("\r\n");
}

/** One SMTP conversation. Resolves when the server has accepted the message. */
function smtp(rcpts, raw) {
  const host = env("SMTP_HOST"), port = Number(env("SMTP_PORT") || 465);
  const secure = env("SMTP_SECURE") ? env("SMTP_SECURE") !== "0" : port === 465;
  const user = env("SMTP_USER"), pass = env("SMTP_PASS");
  const timeoutMs = Number(env("SMTP_TIMEOUT_MS") || 20000);
  return new Promise((resolve, reject) => {
    let sock, buf = "", waiting = null, done = false;
    const fail = e => { if (done) return; done = true; try { sock.destroy(); } catch (x) {} reject(e instanceof Error ? e : new Error(String(e))); };
    const onData = d => {
      buf += d.toString("utf8");
      if (!waiting) return;   // keep it until someone asks for the next reply
      // A reply is complete when its last line is "NNN text" (not "NNN-text")
      const lines = buf.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
          const reply = lines.slice(0, i + 1);
          buf = lines.slice(i + 1).join("\r\n");
          const w = waiting; waiting = null;
          if (w) w({ code: Number(reply[reply.length - 1].slice(0, 3)), lines: reply });
          return onData(Buffer.alloc(0));
        }
      }
    };
    const read = () => new Promise(r => { waiting = r; onData(Buffer.alloc(0)); });
    const cmd = async (line, ok) => {
      if (line != null) sock.write(line + "\r\n");
      const r = await read();
      if (!ok.includes(r.code)) throw new Error(`Email server said: ${r.lines.join(" ").slice(0, 200)}`);
      return r;
    };
    const attach = s => { sock = s; s.setTimeout(timeoutMs, () => fail(new Error("The email server didn't respond in time."))); s.on("data", onData); s.on("error", fail); };
    const talk = async () => {
      try {
        await cmd(null, [220]);
        const me = os.hostname().replace(/[^A-Za-z0-9.-]/g, "") || "localhost";
        let ehlo = await cmd(`EHLO ${me}`, [250]);
        if (!secure && ehlo.lines.some(l => /STARTTLS/i.test(l)) && env("SMTP_STARTTLS") !== "0") {
          await cmd("STARTTLS", [220]);
          if (buf) throw new Error("The email server sent unexpected data before encryption started.");
          buf = "";
          sock.removeAllListeners("data");
          await new Promise((res, rej) => { const t = tls.connect({ socket: sock, servername: host }, res); t.on("error", rej); attach(t); });
          ehlo = await cmd(`EHLO ${me}`, [250]);
        }
        if (user && !secure && !(sock instanceof tls.TLSSocket) && env("SMTP_ALLOW_PLAIN") !== "1")
          throw new Error("The email server didn't offer encryption, so the password wasn't sent. Use SMTP_PORT=465.");
        if (user) {
          await cmd("AUTH LOGIN", [334]);
          await cmd(Buffer.from(user).toString("base64"), [334]);
          await cmd(Buffer.from(pass).toString("base64"), [235]);
        }
        await cmd(`MAIL FROM:<${addr(from())}>`, [250]);
        for (const r of rcpts) await cmd(`RCPT TO:<${r}>`, [250, 251]);
        await cmd("DATA", [354]);
        const body = raw.split("\r\n").map(l => (l.startsWith(".") ? "." + l : l)).join("\r\n");
        await cmd(body + "\r\n.", [250]);
        sock.write("QUIT\r\n");
        done = true; sock.end(); resolve(true);
      } catch (e) { fail(e); }
    };
    try {
      const s = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });
      attach(s);
      s.once(secure ? "secureConnect" : "connect", talk);
    } catch (e) { fail(e); }
  });
}

/** Send an email. msg = { to, cc?, subject, text, html?, replyTo? } */
async function send(msg) {
  const to = [].concat(msg.to || []).filter(Boolean), cc = [].concat(msg.cc || []).filter(Boolean);
  const rcpts = [...new Set([...to, ...cc].map(addr))];
  if (!rcpts.length || !rcpts.every(validEmail)) throw new Error("No valid email address to send to.");
  const raw = build({ ...msg, to, cc });
  if (!env("SMTP_HOST")) {
    if (env("MAIL_OUTBOX") !== "1") throw new Error("Email isn't set up on this server.");
    fs.mkdirSync(path.dirname(OUTBOX), { recursive: true });
    fs.appendFileSync(OUTBOX, JSON.stringify({ at: new Date().toISOString(), to: rcpts, subject: msg.subject, text: msg.text }) + "\n", { mode: 0o600 });
    return true;
  }
  return smtp(rcpts, raw);
}

module.exports = { send, configured, adminEmail, validEmail, build, OUTBOX };
