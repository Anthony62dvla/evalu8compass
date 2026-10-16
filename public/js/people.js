/*
 * Evalu8 Compass — who is signed in, and the Team tab's sign-in, history and trust sections.
 * Head and deputy (or anyone using the shared school code) can do everything; other leaders
 * can't change the team, the school's settings or governors' reports.
 */
(function (root) {
  let H, I, esc, el, acc = null, hist = null;
  const nice = d => d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const canAdmin = () => !acc || acc.canAdmin !== false;

  function apply(a) {
    acc = a; root.HWWD.canAdmin = canAdmin();
    document.body.classList.toggle("not-admin", !canAdmin());
    const who = el("whoAmI");
    if (who) { who.hidden = !(a && a.user); if (a && a.user) who.innerHTML = `${I("user", 16)}<span>${esc(a.user.name || "Signed in")}</span>`; }
    banner(); render(); H.changed && H.changed();
  }
  /** A trust's request to see the school: for the head or deputy to decide, shown at the top of the checklist. */
  function banner() {
    const b = el("trustBanner"); if (!b) return;
    const t = acc && acc.trust;
    b.hidden = !(t && t.status === "pending" && canAdmin());
    if (!b.hidden) b.innerHTML = `${I("building-community", 20)}<div><b>${esc(t.name)} has asked to see a summary of your school's work.</b> <span>Nothing is shared until you agree. Decide in the Team tab.</span></div><a class="btn" href="#team" data-goteam="1">Decide</a>`;
  }
  async function loadHistory() {
    try { const r = await fetch("api/school/history"); hist = r.ok ? (await r.json()).history : []; } catch (e) { hist = []; }
    render();
  }

  function render() {
    const box = el("teamExtra"); if (!box || !acc || !acc.ok) { if (box) box.innerHTML = ""; return; }
    const t = acc.trust, admin = canAdmin(), me = acc.user;
    box.innerHTML = `
      ${t ? `<section class="gov-card tm-trust" aria-labelledby="tmTrustH"><h3 id="tmTrustH">${I("building-community", 18)}${esc(t.name)}</h3>
        ${t.status === "pending" ? `<p class="small"><b>${esc(t.name)} has asked to see a summary of your school's work</b>: your self-evaluation scores by area, safeguarding lines not yet met and termly checks done, improvement plan progress, monitoring counts, governors' reports and questions${t.members.length ? `. Who would see it: ${esc(t.members.map(m => `${m.name} (${m.role})`).join(", "))}` : ""}.</p>
          <p class="small">They would never see evidence notes, what monitoring found, staff workshop comments or anything about individual pupils. You can stop sharing at any time.</p>
          ${admin ? `<div class="row"><button class="btn primary" type="button" data-trust="confirm">${I("circle-check", 16)}Share with ${esc(t.name)}</button><button class="btn" type="button" data-trust="decline">Decline</button></div>` : `<p class="small">Your headteacher or deputy decides.</p>`}`
        : `<p class="small">Your school shares a summary with ${esc(t.name)} (since ${esc(nice(t.confirmedAt))}): scores, safeguarding checks done, plan progress, monitoring counts and governors' reports. Never evidence notes, monitoring findings or pupils' information.</p>
          ${admin ? `<div class="row"><button class="btn" type="button" data-trust="leave">Stop sharing</button></div>` : ""}`}
      </section>` : ""}
      <section class="gov-card" aria-labelledby="tmSignH"><h3 id="tmSignH">${I("key", 18)}Signing in</h3>
        <p class="small">Everyone in the team above with an email address can sign in as themselves: they choose <b>Sign in with your email</b> and we email them a 6-digit code. No passwords. Their changes are recorded with their name. The headteacher and deputy can change everything; other leaders can't change the team, the school's settings or governors' reports. Governors use the governors' code; advisers can't sign in.</p>
        ${me ? `<p class="small">You're signed in as <b>${esc(me.name)}</b>.</p>` : `<p class="small">You're signed in with the shared school code.</p>`}
        ${admin ? `<div class="row"><button class="btn" type="button" data-invite="1">${I("mail", 16)}Email sign-in instructions to the team</button></div>` : ""}
        ${admin ? `<div class="sharedcode"><h4>The shared school code</h4>
          <p class="small">${acc.codeOff ? "Switched off: everyone signs in with their own email. The code no longer works." : "Still works, so anyone with it can sign in as the school. Once everyone has their own sign-in, the head or deputy can switch it off."}</p>
          ${me && me.admin ? `<button class="btn" type="button" data-shared="${acc.codeOff ? "on" : "off"}">${I(acc.codeOff ? "key" : "lock", 16)}${acc.codeOff ? "Switch the shared code back on" : "Switch off the shared code"}</button>` : `<p class="small">To switch it off, sign in with your own email first.</p>`}</div>` : ""}
      </section>
      <section class="gov-card" aria-labelledby="tmHistH"><h3 id="tmHistH">${I("history", 18)}Recent changes</h3>
        ${hist === null ? `<p class="small">Loading…</p>` : hist.length ? `<ul class="hist">${hist.slice(0, 15).map(h => `<li><span class="hist-when">${esc(nice(h.at))}</span><b>${esc(h.by || "Someone")}</b><span>${esc(h.what)}</span></li>`).join("")}</ul>` : `<p class="small">No changes recorded yet.</p>`}
        <button class="linkbtn" type="button" data-hist="1">Refresh</button>
      </section>`;
  }

  async function post(url, body) { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }); return { ok: r.ok, d: await r.json().catch(() => ({})) }; }
  async function onClick(e) {
    const b = e.target.closest("button, a[data-goteam]"); if (!b) return false;
    const d = b.dataset;
    if (d.goteam) { e.preventDefault(); H.showTeam && H.showTeam(); return true; }
    if (!el("teamExtra") || !el("teamExtra").contains(b)) return false;
    if (d.hist) { hist = null; render(); loadHistory(); return true; }
    if (d.invite) { b.disabled = true; const { ok, d: r } = await post("api/school/team/invite"); H.toast(ok ? `Sign-in instructions emailed to ${r.sent} ${r.sent === 1 ? "person" : "people"}` : r.error || "That didn't send."); b.disabled = false; return true; }
    if (d.shared) {
      if (d.shared === "off" && !confirm("Switch off the shared school code? Anyone signed in with it will be signed out, and everyone will need to sign in with their own email.")) return true;
      const { ok, d: r } = await post("api/school/sharedcode", { on: d.shared === "on" });
      if (!ok) { H.toast(r.error || "That didn't work."); return true; }
      acc.codeOff = r.codeOff; render(); H.toast(r.codeOff ? "Shared code switched off" : "Shared code switched back on"); return true;
    }
    if (d.trust) {
      if (d.trust === "leave" && !confirm(`Stop sharing with ${acc.trust.name}? They won't see your school's summary any more.`)) return true;
      const { ok, d: r } = await post(`api/school/trust/${d.trust}`);
      if (!ok) { H.toast(r.error || "That didn't work."); return true; }
      acc.trust = r.trust; banner(); render(); H.toast({ confirm: "Sharing with the trust", decline: "Request declined", leave: "Stopped sharing" }[d.trust]); return true;
    }
    return false;
  }
  function init(host) {
    H = host; I = host.icon; esc = host.esc; el = id => document.getElementById(id);
    document.addEventListener("click", e => { onClick(e).then(done => { if (done) e.stopPropagation(); }); }, true);
  }
  function shown() { if (hist === null) loadHistory(); else render(); }
  root.HWWD.people = { init, apply, shown, canAdmin };
})(window);
