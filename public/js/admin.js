/* Evalu8 Compass superadmin console */
(function () {
  const $ = id => document.getElementById(id);
  const I = window.HWWD.icon;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const day = d => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–";
  const when = d => d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const SITE = location.origin;
  const SUPPORT = "support@evalu8compass.app";
  const ACTION = {
    "admin.setup": "Superadmin set up", "admin.login": "Signed in", "admin.logout": "Signed out", "admin.login_failed": "Failed sign-in attempt",
    "code.create": "Code created", "code.revoke": "Code revoked", "code.reactivate": "Code reactivated", "code.extend": "Expiry changed",
  };
  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2400); }
  async function api(method, path, body) {
    const r = await fetch("api/admin" + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== "/login") { show("login"); throw new Error("Your admin session has ended. Sign in again."); }
    if (!r.ok) throw new Error(d.error || "Something went wrong.");
    return d;
  }
  function show(which) {
    $("notSetUp").classList.toggle("hide", which !== "setup");
    $("loginForm").classList.toggle("hide", which !== "login");
    $("console").classList.toggle("hide", which !== "console");
    $("signOut").hidden = which !== "console";
    if (which === "login") setTimeout(() => $("pw").focus(), 50);
  }
  async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); toast(label || "Copied"); }
    catch (e) { toast("Select the text and copy it"); }
  }

  /* ---------- console ---------- */
  async function load() {
    const d = await api("GET", "/overview");
    const s = d.stats, y = d.system;
    $("stats").innerHTML = [
      ["building", s.activeCodes, "Active school codes"], ["login", s.schoolsSignedIn30, "Schools signed in (30 days)"],
      ["users-group", s.workshops30, `Workshops (30 days) · ${s.workshops} in total`], ["users", s.participants, "Staff responses (all workshops)"],
    ].map(([ic, n, l]) => `<div class="stat"><span class="tile">${I(ic, 24)}</span><div><b>${esc(n)}</b><span>${esc(l)}</span></div></div>`).join("");
    $("sys").innerHTML = `<span><i class="dot" style="background:${y.ai ? "var(--met)" : "var(--no)"}"></i>AI ${y.ai ? "connected (" + esc(y.model) + ")" : "not connected: add ANTHROPIC_API_KEY to .env"}</span>
      <span><i class="dot" style="background:${y.accessRequired ? "var(--met)" : "var(--part)"}"></i>${y.accessRequired ? "Access codes required" : "Site open: no codes created yet"}</span>
      <span>Node ${esc(y.node)} · up ${esc(y.uptimeHours)} h</span>`;
    const codes = d.codes.slice().sort((a, b) => (a.state === "active" ? 0 : 1) - (b.state === "active" ? 0 : 1) || a.name.localeCompare(b.name));
    $("codes").innerHTML = `<thead><tr><th>School</th><th>Status</th><th>Created</th><th>Expires</th><th>Last signed in</th><th>Workshops</th><th>Actions</th></tr></thead><tbody>${
      codes.length ? codes.map(c => `<tr>
        <td><b>${esc(c.name)}</b>${c.email ? `<span class="sub">${esc(c.email)}</span>` : ""}${c.notes ? `<span class="sub">${esc(c.notes)}</span>` : ""}<span class="sub">id ${esc(c.id)}</span></td>
        <td><span class="state state-${c.state}">${c.state[0].toUpperCase() + c.state.slice(1)}</span></td>
        <td>${day(c.createdAt)}</td><td>${c.expiresAt ? day(c.expiresAt) : "Never"}</td><td>${c.lastUsedAt ? day(c.lastUsedAt) : "Never"}</td>
        <td class="num">${c.workshops}${c.participants ? `<span class="sub">${c.participants} staff</span>` : ""}</td>
        <td><div class="acts">${c.state === "revoked"
          ? `<button class="btn" data-act="reactivate" data-id="${c.id}">${I("refresh", 16)}Reactivate</button>`
          : `<button class="btn" data-act="revoke" data-id="${c.id}" data-name="${esc(c.name)}">${I("x", 16)}Revoke</button>`}
          <button class="btn" data-act="extend" data-id="${c.id}" data-days="365">${I("calendar-check", 16)}+1 year</button>
          ${c.expiresAt ? `<button class="btn" data-act="extend" data-id="${c.id}" data-days="0">No expiry</button>` : ""}</div></td>
      </tr>`).join("") : `<tr class="empty-row"><td colspan="7">No school codes yet. Create the first one above.</td></tr>`
    }</tbody>`;
    $("audit").innerHTML = d.audit.length ? d.audit.map(a => `<li><time datetime="${esc(a.at)}">${esc(when(a.at))}</time><span class="${a.action === "admin.login_failed" ? "fail" : ""}">${esc(ACTION[a.action] || a.action)}${a.detail ? ": " + esc(a.detail) : ""} <span class="muted small">(${esc(a.ip)})</span></span></li>`).join("") : `<li><span class="muted">Nothing yet.</span></li>`;
  }

  $("codes").addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const { act, id } = b.dataset;
    if (act === "revoke" && !b.dataset.confirm) {
      b.dataset.confirm = "1"; b.innerHTML = `${I("alert-triangle", 16)}Click again to revoke`; b.classList.add("danger");
      setTimeout(() => { if (b.isConnected) { delete b.dataset.confirm; b.innerHTML = `${I("x", 16)}Revoke`; b.classList.remove("danger"); } }, 4000);
      return;
    }
    b.disabled = true;
    try {
      await api("POST", `/codes/${id}/${act}`, act === "extend" ? { days: Number(b.dataset.days) } : {});
      toast({ revoke: "Code revoked. It stops working straight away.", reactivate: "Code reactivated", extend: "Expiry updated" }[act]);
      await load();
    } catch (err) { toast(err.message); b.disabled = false; }
  });

  $("newForm").addEventListener("submit", async e => {
    e.preventDefault(); $("nErr").textContent = "";
    const body = { name: $("nName").value.trim(), email: $("nEmail").value.trim(), days: Number($("nDays").value), notes: $("nNotes").value.trim() };
    $("nBtn").disabled = true;
    try {
      const r = await api("POST", "/codes", body);
      $("ncSchool").textContent = r.name; $("ncCode").textContent = r.code;
      const msg = `Hello,\n\nHere is ${r.name}'s access code for Evalu8 Compass:\n\n${r.code}\n\nGo to ${SITE}/enter.html and enter the code. It opens the self-evaluation checklist, staff workshops, reports and the AI inspector for your leadership team. Please share it only with leaders who need it.${r.expiresAt ? `\n\nThe code works until ${day(r.expiresAt)}.` : ""}\n\nStaff joining a workshop don't need this code; they use the workshop code shown on the screen.\n\nAny questions: ${SUPPORT}\n`;
      $("ncMsg").value = msg;
      const mail = $("ncMail");
      if (body.email) { mail.href = `mailto:${encodeURIComponent(body.email)}?subject=${encodeURIComponent("Your Evalu8 Compass access code")}&body=${encodeURIComponent(msg)}`; mail.classList.remove("hide"); } else mail.classList.add("hide");
      $("newCode").classList.remove("hide");
      $("newForm").reset(); $("nDays").value = "365";
      await load();
    } catch (err) { $("nErr").textContent = err.message; }
    $("nBtn").disabled = false;
  });
  $("ncCopy").onclick = () => copy($("ncCode").textContent, "Code copied");
  $("ncCopyMsg").onclick = () => copy($("ncMsg").value, "Message copied");
  $("refresh").onclick = () => load().then(() => toast("Up to date")).catch(e => toast(e.message));

  /* ---------- sign in / out ---------- */
  $("otp").addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); });
  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault(); $("loginErr").textContent = ""; $("loginBtn").disabled = true;
    try {
      await api("POST", "/login", { password: $("pw").value, code: $("otp").value });
      $("pw").value = ""; $("otp").value = "";
      show("console"); await load();
    } catch (err) { $("loginErr").textContent = err.message; $("otp").value = ""; }
    $("loginBtn").disabled = false;
  });
  $("signOut").onclick = async e => { e.preventDefault(); await api("POST", "/logout").catch(() => {}); show("login"); };

  (async () => {
    try {
      const me = await fetch("api/admin/me").then(r => r.json());
      if (!me.configured) return show("setup");
      if (!me.signedIn) return show("login");
      show("console"); await load();
    } catch (e) { show("login"); }
  })();
})();
