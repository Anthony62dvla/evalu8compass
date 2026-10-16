/*
 * Individual sign-in with an emailed code
 * ------------------------------------------------------------
 * Anyone on a school's leadership team (Team tab, with their email) or a trust's leaders can sign in
 * by typing their email: a 6-digit code is emailed, valid for 10 minutes, five tries. No passwords.
 * Governors use the governors' code; external advisers can't sign in.
 * The answer is always the same whether or not the email is known, so it can't be used to find out
 * who works where.
 */
const crypto = require("crypto");
const access = require("./access");
const schools = require("./schools");
const trusts = require("./trusts");
const mail = require("./mail");
const B = require("./billing");

const CAN_SIGN_IN = r => !["sip", "gov", "trustee"].includes(r);
const ADMIN = ["head", "deputy"];
const TTL = 10 * 60e3;
const pending = new Map();   // email → { hash, exp, tries }
class LoginError extends Error { constructor(status, message) { super(message); this.status = status; } }
const norm = e => String(e || "").trim().toLowerCase().slice(0, 200);
const h = s => crypto.createHash("sha256").update(String(s)).digest("hex");

/** Where this email can sign in: schools (active, with the person on the team) and trusts. */
function targets(email) {
  const e = norm(email), out = [];
  for (const c of access.list()) {
    if (c.revoked || (c.expiresAt && Date.parse(c.expiresAt) < Date.now())) continue;
    const st = schools.get(c.id).state; if (!st) continue;
    const m = (st.team || []).find(x => x.email === e && CAN_SIGN_IN(x.role));
    if (m) out.push({ kind: "school", id: c.id, name: c.name, member: m });
  }
  for (const { trust, member } of trusts.membersByEmail(e)) out.push({ kind: "trust", id: trust.id, name: trust.name, member });
  return out;
}

/** Step 1: email a code, if this email can sign in anywhere. */
async function start(email) {
  const e = norm(email);
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e)) throw new LoginError(400, "Enter your work email address.");
  if (!mail.configured()) throw new LoginError(503, "Email sign-in isn't available right now. Use your school's access code.");
  if (B.tooMany("login-email:" + e, 5, 3600e3)) throw new LoginError(429, "Too many codes requested for that address. Try again in an hour, or use your school's access code.");
  const t = targets(e);
  if (!t.length) return { sent: true };   // the same answer, so nobody can test which emails are known
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  pending.set(e, { hash: h(e + ":" + code), exp: Date.now() + TTL, tries: 0 });
  const where = t.length === 1 ? t[0].name : t.map(x => x.name).join(", ");
  await mail.send({ to: e, subject: `Your Evalu8 Compass sign-in code: ${code}`,
    text: [`Your sign-in code is ${code}`, "", `It works for 10 minutes. Use it to sign in to ${where}.`, "", "If you didn't ask for this, you can ignore this email: nobody can sign in without the code."].join("\n"),
    html: B.wrap("Your sign-in code", B.para(`Use this code to sign in to <b>${B.esc(where)}</b>. It works for 10 minutes.`) +
      `<p style="font-size:30px;font-weight:bold;letter-spacing:6px;background:#E1F5EE;color:#04342C;padding:12px 18px;border-radius:8px;display:inline-block">${code}</p>` +
      B.para("If you didn't ask for this, you can ignore this email: nobody can sign in without the code.")) });
  return { sent: true };
}

/** Step 2: check the code. Returns the places this person can sign in (choose one if more than one). */
function check(email, code) {
  const e = norm(email), p = pending.get(e);
  if (!p || p.exp < Date.now()) { pending.delete(e); throw new LoginError(400, "That code has expired. Ask for a new one."); }
  if (p.tries >= 5) { pending.delete(e); throw new LoginError(429, "Too many wrong codes. Ask for a new one."); }
  const want = Buffer.from(p.hash), got = Buffer.from(h(e + ":" + String(code || "").replace(/\D/g, "")));
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) { p.tries++; throw new LoginError(400, "That code isn't right. Check the email and try again."); }
  return targets(e);
}
/** Step 3: sign in to one place. The code is used up. */
function finish(req, res, email, code, choice) {
  const t = check(email, code), e = norm(email);
  if (!t.length) { pending.delete(e); throw new LoginError(403, "You're no longer on a team that can sign in here."); }
  const pick = choice ? t.find(x => `${x.kind}:${x.id}` === choice) : t.length === 1 ? t[0] : null;
  if (!pick) return { choose: t.map(x => ({ key: `${x.kind}:${x.id}`, name: x.name, kind: x.kind })) };
  pending.delete(e);
  if (pick.kind === "trust") { trusts.login(req, res, pick.id, pick.member.id); return { ok: true, kind: "trust", name: pick.name }; }
  access.loginUser(req, res, pick.id, pick.member, access.hashEmail(e));
  return { ok: true, kind: "school", name: pick.name, user: { name: pick.member.name, role: pick.member.role } };
}

/** For access.who(): is this person still on the school's team, with the same email? */
function userCheck(schoolId, memberId, emailHash) {
  const st = schools.get(schoolId).state; if (!st) return null;
  const m = (st.team || []).find(x => x.id === memberId && access.hashEmail(x.email) === emailHash && CAN_SIGN_IN(x.role));
  return m ? { id: m.id, name: m.name, role: m.role, admin: ADMIN.includes(m.role) } : null;
}
/** Shared-code sessions and the superadmin can do everything; signed-in people by their role. */
const canAdmin = w => !!w && (w.admin || w.open || !w.user || w.user.admin);
const byName = w => !w ? "" : w.user ? w.user.name || "A leader" : w.admin ? "Evalu8 Compass support" : "Shared school code";

module.exports = { start, check, finish, targets, userCheck, canAdmin, byName, CAN_SIGN_IN, ADMIN, LoginError, _pending: pending };
