/* Superadmin: trusts and groups (see lib/trusts.js). */
(function () {
  const I = window.HWWD.icon, $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const day = d => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
  let data = null;
  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2400); }
  async function api(method, path, body) {
    const r = await fetch("api/admin" + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "Something went wrong."); return d;
  }
  function render() {
    const box = $("trustsBox"); if (!box || !data) return;
    const linkedAnywhere = new Set(data.trusts.flatMap(t => t.schools.map(s => s.id)));
    box.innerHTML = data.trusts.length ? data.trusts.map(t => `<article class="trust-card" aria-label="${esc(t.name)}">
      <div class="trust-top"><h3>${esc(t.name)}</h3><span class="muted small">created ${esc(day(t.createdAt))}</span><span class="spacer"></span><button class="btn danger" type="button" data-tdel="${t.id}" data-name="${esc(t.name)}">${I("trash", 16)}Delete trust</button></div>
      <div class="trust-cols">
        <div><h4>Trust leaders</h4>${t.members.length ? `<ul class="tlist">${t.members.map(m => `<li><b>${esc(m.name)}</b> <span class="muted small">${esc(data.roles[m.role] || m.role)} · ${esc(m.email)}</span> <button class="linkbtn" type="button" data-tmrm="${t.id}|${m.id}">Remove</button></li>`).join("")}</ul>` : `<p class="muted small">None yet.</p>`}
          <form class="tform" data-tmadd="${t.id}"><label class="sr-only" for="tmn-${t.id}">Name</label><input id="tmn-${t.id}" name="name" placeholder="Name" maxlength="100"><label class="sr-only" for="tme-${t.id}">Email</label><input id="tme-${t.id}" name="email" type="email" placeholder="Email" maxlength="200">
            <label class="sr-only" for="tmr-${t.id}">Role</label><select id="tmr-${t.id}" name="role">${Object.entries(data.roles).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}</select><button class="btn" type="submit">${I("user", 16)}Add</button></form></div>
        <div><h4>Schools</h4>${t.schools.length ? `<ul class="tlist">${t.schools.map(s => `<li><b>${esc(s.name)}</b> <span class="state state-${s.status === "linked" ? "active" : "expired"}">${s.status === "linked" ? "Sharing" : "Waiting for the head"}</span> <span class="muted small">${s.status === "linked" ? "since " + esc(day(s.confirmedAt)) + (s.confirmedBy ? " (" + esc(s.confirmedBy) + ")" : "") : "asked " + esc(day(s.requestedAt))}</span> <button class="linkbtn" type="button" data-tsrm="${t.id}|${s.id}">Remove</button></li>`).join("")}</ul>` : `<p class="muted small">None yet.</p>`}
          <form class="tform" data-tsadd="${t.id}"><label class="sr-only" for="tsl-${t.id}">School</label><select id="tsl-${t.id}" name="school"><option value="">Choose a school…</option>${data.schools.filter(s => !linkedAnywhere.has(s.id)).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select><button class="btn" type="submit">${I("mail", 16)}Ask to link</button></form>
          <p class="muted small">The school's head and deputy are emailed and decide in their Team tab.</p></div>
      </div></article>`).join("") : `<p class="muted small">No trusts yet.</p>`;
  }
  async function load() { try { data = await api("GET", "/trusts"); render(); } catch (e) { /* not signed in */ } }
  document.addEventListener("submit", async e => {
    const f = e.target;
    if (f.id === "trustNew") { e.preventDefault(); try { await api("POST", "/trusts", { name: $("trustName").value }); $("trustName").value = ""; toast("Trust created"); await load(); } catch (err) { toast(err.message); } return; }
    if (f.dataset.tmadd) { e.preventDefault(); try { await api("POST", `/trusts/${f.dataset.tmadd}/member`, { name: f.name.value, email: f.email.value, role: f.role.value }); toast("Trust leader added"); await load(); } catch (err) { toast(err.message); } return; }
    if (f.dataset.tsadd) { e.preventDefault(); if (!f.school.value) return toast("Choose a school"); try { await api("POST", `/trusts/${f.dataset.tsadd}/school`, { school: f.school.value }); toast("Request sent to the school"); await load(); } catch (err) { toast(err.message); } }
  });
  document.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b || !$("trustsBox") || !$("trustsBox").contains(b)) return;
    const d = b.dataset;
    try {
      if (d.tdel) { if (!confirm(`Delete ${d.name}? Its leaders lose access and its schools stop sharing. Schools' own work isn't affected.`)) return; await api("POST", `/trusts/${d.tdel}/delete`); toast("Trust deleted"); }
      else if (d.tmrm) { const [t, m] = d.tmrm.split("|"); await api("POST", `/trusts/${t}/member-remove`, { member: m }); toast("Removed"); }
      else if (d.tsrm) { const [t, s] = d.tsrm.split("|"); if (!confirm("Remove this school from the trust? It stops sharing straight away.")) return; await api("POST", `/trusts/${t}/school-remove`, { school: s }); toast("School removed"); }
      else return;
      await load();
    } catch (err) { toast(err.message); }
  });
  const c = $("console");
  if (c) { new MutationObserver(() => { if (!c.classList.contains("hide")) load(); }).observe(c, { attributes: true, attributeFilter: ["class"] }); if (!c.classList.contains("hide")) load(); }
})();
