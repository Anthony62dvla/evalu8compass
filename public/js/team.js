/*
 * Evalu8 Compass — the Team tab: the leadership team and their email alerts
 */
(function (root) {
  const L = root.HWWD.leaders;
  let H, I, esc, el, mailOn = null;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const team = () => H.state().team || (H.state().team = []);

  function render() {
    const box = el("teamList"); if (!box) return;
    const t = team();
    el("teamTabCount").textContent = t.length ? ` (${t.length})` : "";
    const keys = L.keyLeaders(t).map(m => m.role);
    const missing = ["head", "dsl"].filter(r => !keys.includes(r));
    el("teamWarn").innerHTML = missing.length && mailOn !== false
      ? `${I("alert-triangle", 18)}<span>Add your ${missing.map(r => r === "head" ? "headteacher" : "designated safeguarding lead").join(" and ")} with ${missing.length > 1 ? "their email addresses" : "an email address"}, so safeguarding alerts reach them.</span>` : "";
    el("teamWarn").hidden = !el("teamWarn").innerHTML;
    el("teamMail").innerHTML = mailOn === false
      ? `${I("alert-triangle", 18)}<span>Emails aren't switched on for this service yet, so alerts can't be sent. Your team list is saved and will be used once they are.</span>` : "";
    el("teamMail").hidden = mailOn !== false;
    box.innerHTML = t.length ? t.map(m => `
      <article class="member" data-mid="${m.id}" aria-label="${esc(m.name || "New team member")}">
        <div class="member-grid">
          <div class="field"><label for="tm-name-${m.id}">Name</label><input type="text" id="tm-name-${m.id}" data-mfield="name" value="${esc(m.name)}" maxlength="100" autocomplete="off"></div>
          <div class="field"><label for="tm-role-${m.id}">Role</label><select id="tm-role-${m.id}" data-mfield="role">${L.ROLES.map(([k, label]) => `<option value="${k}"${m.role === k ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></div>
          <div class="field"><label for="tm-email-${m.id}">Email</label><input type="email" id="tm-email-${m.id}" data-mfield="email" value="${esc(m.email)}" maxlength="200" autocomplete="off"${m.email && !L.validEmail(m.email) ? ' aria-invalid="true"' : ""}></div>
          <div class="field"><label for="tm-alerts-${m.id}">Emails</label><select id="tm-alerts-${m.id}" data-mfield="alerts"><option value="weekly"${m.alerts !== "urgent" ? " selected" : ""}>Monday summary and urgent alerts</option><option value="urgent"${m.alerts === "urgent" ? " selected" : ""}>Urgent alerts only</option></select></div>
        </div>
        <div class="member-foot">
          ${L.KEY.includes(m.role) ? `<span class="keytag">${I("shield-check", 16)}Gets immediate alerts</span>` : `<span class="muted-inline">Gets alerts about actions they own</span>`}
          <span class="spacer"></span>
          <button class="btn" type="button" data-mtest="${m.id}"${!L.validEmail(m.email) || mailOn === false ? " disabled" : ""}>${I("mail", 16)}Send a test email</button>
          <button class="btn" type="button" data-mdel="${m.id}" aria-label="Remove ${esc(m.name || "this person")}">${I("x", 16)}Remove</button>
        </div>
      </article>`).join("")
      : `<div class="plan-empty"><span class="tile">${I("users", 26)}</span><h3>Add your leadership team</h3><p>Start with your headteacher, deputy and designated safeguarding lead. Then add the leaders who own actions, such as your SENCo and attendance lead.</p></div>`;
    // Owner suggestions in the action plan
    const dl = el("ownerList");
    if (dl) dl.innerHTML = [...new Set([...t.map(m => m.name).filter(Boolean), ...t.map(m => L.SHORT[m.role]).filter(r => r && r !== "Other")])].map(v => `<option value="${esc(v)}"></option>`).join("");
  }

  function onClick(e) {
    const b = e.target.closest("button"); if (!b) return false;
    if (b.id === "teamAdd") {
      const m = { id: uid(), name: "", role: team().some(x => x.role === "head") ? (team().some(x => x.role === "dsl") ? "other" : "dsl") : "head", email: "", alerts: "weekly", areas: [], subjects: [] };
      team().push(m); H.save(); render(); el("tm-name-" + m.id).focus(); return true;
    }
    if (b.dataset.mdel) {
      const list = team(), i = list.findIndex(m => m.id === b.dataset.mdel); if (i < 0) return true;
      const [gone] = list.splice(i, 1); H.save(); render();
      H.undo(`${gone.name || "Team member"} removed`, () => { list.splice(i, 0, gone); H.save(); render(); });
      return true;
    }
    if (b.dataset.mtest) { test(b); return true; }
    return false;
  }
  async function test(b) {
    b.disabled = true;
    await H.flush();
    try {
      const r = await fetch("api/school/team/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: b.dataset.mtest }) });
      const d = await r.json();
      H.toast(r.ok ? `Test email sent to ${d.to}` : d.error || "That didn't send.");
    } catch (e) { H.toast("Couldn't reach the server. Try again."); }
    b.disabled = false;
  }
  function onInput(e) {
    const f = e.target.dataset.mfield; if (!f) return;
    const card = e.target.closest("[data-mid]"); const m = team().find(x => x.id === card.dataset.mid); if (!m) return;
    m[f] = f === "email" ? e.target.value.trim() : e.target.value; H.save();
    if (f === "role" || f === "email") render();
  }
  function init(host) {
    H = host; I = host.icon; esc = host.esc; el = id => document.getElementById(id);
    document.addEventListener("click", e => { if (onClick(e)) e.stopPropagation(); }, true);
    document.addEventListener("input", e => { if (e.target.dataset.mfield && e.target.tagName !== "SELECT" && e.target.type !== "email") onInput(e); });
    document.addEventListener("change", e => { if (e.target.dataset.mfield) onInput(e); });
    render();
  }
  function setMail(on) { mailOn = on; render(); }
  root.HWWD.team = { init, render, setMail };
})(window);
