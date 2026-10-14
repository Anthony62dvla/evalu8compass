/*
 * Keeping bots out of the public forms (school sign-up and consultant applications)
 * ------------------------------------------------------------
 *  1. Timing: each form gets a signed timestamp when the page loads. A form sent
 *     back within a few seconds was filled in by a script, not a person.
 *  2. Throwaway email services are refused: no school or consultant uses them.
 *  3. Sign-ups that don't look like a school (a free webmail address, no URN, a
 *     name that doesn't look like a school's) are flagged for the superadmin to check.
 * (The forms also have a hidden field that only bots fill in, and rate limits.)
 */
const access = require("./access");

const MIN_MS = () => { const v = process.env.FORM_MIN_SECONDS; return Math.max(0, (v == null || v === "" ? 3 : Number(v)) * 1000); };
const MAX_MS = 24 * 3600e3;

/** A signed "this form was loaded at" token. */
function token() { const ts = String(Date.now()); return `${ts}.${access.sign("form:" + ts)}`; }
/** "ok", "missing" (no or bad token), "fast" (sent too quickly to be a person) or "stale" (page open over a day). */
function check(tok) {
  const [ts, sig] = String(tok || "").split(".");
  if (!ts || !sig || !/^\d{10,16}$/.test(ts) || access.sign("form:" + ts) !== sig) return "missing";
  const age = Date.now() - Number(ts);
  if (age < MIN_MS()) return "fast";
  if (age > MAX_MS) return "stale";
  return "ok";
}

/* Throwaway ("disposable") email services */
const DISPOSABLE = new Set(`mailinator.com mailinator.net mailinator.org guerrillamail.com guerrillamail.net guerrillamail.org guerrillamail.biz guerrillamail.de sharklasers.com grr.la guerrillamailblock.com pokemail.net spam4.me
10minutemail.com 10minutemail.net 10minutemail.co.uk 10minemail.com 20minutemail.com tempmail.com temp-mail.org temp-mail.io tempmail.net tempmail.dev tempmailo.com tempmail.plus tempr.email tempail.com
throwawaymail.com trashmail.com trashmail.net trashmail.de trashmail.io trash-mail.com yopmail.com yopmail.net yopmail.fr cool.fr.nf jetable.org mytemp.email moakt.com getnada.com nada.email
dispostable.com maildrop.cc mailnesia.com mintemail.com mohmal.com emailondeck.com fakeinbox.com fakemail.net mailcatch.com mailpoof.com mailsac.com inboxkitten.com spambox.us spamgourmet.com
burnermail.io discard.email discardmail.com dropmail.me emailfake.com email-fake.com fakemailgenerator.com harakirimail.com incognitomail.org instantemailaddress.com luxusmail.org mail7.io
mailforspam.com mailhazard.com mailtemp.net meltmail.com mvrht.net nowmymail.com one-time.email owlymail.com rcpt.at spamdecoy.net tempinbox.com tempmailaddress.com temporarymail.com
throwam.com tmail.ws tmpmail.net tmpmail.org trbvm.com wegwerfmail.de wegwerfmail.net emltmp.com dcctb.com 1secmail.com 1secmail.net 1secmail.org esiix.com wwjmp.com xojxe.com yoggm.com
linshiyouxiang.net mailto.plus fexpost.com fexbox.org rover.info inbox.lv byom.de anonbox.net spamex.com tempm.com guerillamail.com zetmail.com vomoto.com tafmail.com`.split(/\s+/).filter(Boolean));
/* Free webmail: fine to use, but unusual for a school's sign-up */
const WEBMAIL = new Set(`gmail.com googlemail.com hotmail.com hotmail.co.uk outlook.com outlook.co.uk live.com live.co.uk msn.com yahoo.com yahoo.co.uk ymail.com rocketmail.com icloud.com me.com mac.com
aol.com aol.co.uk protonmail.com proton.me pm.me gmx.com gmx.co.uk gmx.net mail.com yandex.com yandex.ru zoho.com tutanota.com tuta.io btinternet.com btopenworld.com sky.com talktalk.net
virginmedia.com ntlworld.com blueyonder.co.uk tiscali.co.uk mail.ru qq.com 163.com 126.com hushmail.com fastmail.com`.split(/\s+/).filter(Boolean));

const domainOf = email => String(email || "").toLowerCase().split("@")[1] || "";
const isDisposable = email => { const d = domainOf(email); return DISPOSABLE.has(d) || [...DISPOSABLE].some(x => d.endsWith("." + x)); };
const isWebmail = email => WEBMAIL.has(domainOf(email));

/* Words that appear in almost every school's name */
const SCHOOLISH = /\b(school|schools|academy|academies|college|primary|secondary|nursery|infants?|junior|juniors|high|grammar|prep|preparatory|centre|center|federation|trust|church|c ?of ?e|ce|c ?e|rc|catholic|methodist|jewish|muslim|islamic|st|saint|community|kindergarten|free|studio|utc|pru|pupil|referral|learning|education|educational|sixth|form|international|house|hall|lyc[eé]e|montessori|steiner|waldorf|abbey|priory|cathedral|collegiate|foundation|special|alternative|provision|campus|institute|seminary|madrasah?|yeshiva|kindergarten|day|boarding|girls|boys|ladies|vi)\b/i;

/** Reasons a school sign-up should be checked by a person (empty if it looks fine). */
function signupFlags({ school, email, urn, type }) {
  const out = [];
  if (isWebmail(email)) out.push(`uses a personal email address (${domainOf(email)}), not a school one`);
  if (!urn && type !== "trust") out.push("no URN given");
  const name = String(school || "").trim();
  if (!SCHOOLISH.test(name) || /https?:|www\.|\.com\b|[<>{}]|(.)\1{4,}/i.test(name) || !/[aeiou]/i.test(name)) out.push(`the name "${name.slice(0, 60)}" doesn't look like a school's`);
  return out;
}

module.exports = { token, check, isDisposable, isWebmail, signupFlags, domainOf };
