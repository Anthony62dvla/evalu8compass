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
    "data.erase": "School data deleted", "school.delete": "School deleted", "ai.allowance": "AI allowance changed", "data.retention_delete": "Deleted under retention policy",
    "signup.code": "School signed up", "signup.checked": "Sign-up checked", "bot.blocked": "Bot blocked", "signup.resend": "New code emailed", "signup.trust_enquiry": "Trust enquiry",
    "billing.subscribe": "School subscribed", "billing.send-invoice": "Invoice sent", "billing.mark-paid": "Marked paid", "billing.mark-unpaid": "Marked unpaid",
    "ai.topup_request": "AI top-up requested", "ai.topup_approve": "AI top-up approved", "ai.topup_decline": "AI top-up declined", "ai.topup_paid": "AI top-up paid", "ai.credits": "Extra AI requests changed",
    "billing.cancel": "Subscription cancelled", "billing.set-trial": "Free term set", "billing.reminder": "Reminder emailed",
  };
  const TIER = { independent: "Independent £99", primary: "Primary £149", secondary: "Secondary £199", trust: "Trust" };
  const gbp = n => "£" + (Math.round(n * 100) / 100).toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const ymd = d => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const before = d => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
  const STATE_CLASS = { trial: "active", paid: "active", invoiced: "active", invoice_to_send: "expired", overdue: "revoked", trial_ended: "expired", lapsed: "expired", trial_grace: "expired", grace: "expired", cancelled: "revoked", revoked: "revoked", none: "active" };

  async function loadBilling() {
    const d = await api("GET", "/billing"), T = d.totals;
    $("billSys").innerHTML = `<span><i class="dot" style="background:${d.mail ? "var(--met)" : "var(--no)"}"></i>${d.mail ? "Email set up: sign-up codes and reminders are sent automatically" + (d.adminEmail ? ` · notifications to ${esc(d.adminEmail)}` : "") : "Email not set up: add SMTP_HOST and the other SMTP settings to .env, or schools can't sign up"}</span>
      <span><i class="dot" style="background:${d.canInvoice ? "var(--met)" : "var(--part)"}"></i>${d.canInvoice ? "Invoices are sent automatically when a school subscribes" : "Invoices aren't automatic yet: add OPERATOR_NAME and bank details to .env"}</span>
      <span>${d.vat ? "VAT added to invoices" : "No VAT charged"}</span>`;
    $("billStats").innerHTML = [
      ["gift", T.trial, "In their free term"], ["circle-check", T.subscribed, "Subscribed"], ["receipt", T.toInvoice, "Invoices to send"],
      ["alert-triangle", T.overdue, "Overdue"], ["coin-pound", gbp(T.invoicedThisYear), "Invoiced this year"], ["history", gbp(T.outstanding), "Unpaid"],
    ].map(([ic, n, l]) => `<div class="stat"><span class="tile">${I(ic, 22)}</span><div><b>${esc(n)}</b><span>${esc(l)}</span></div></div>`).join("");
    const order = { overdue: 0, invoice_to_send: 1, grace: 2, trial_grace: 2, invoiced: 3, trial_ended: 4, trial: 5, paid: 6, lapsed: 7, cancelled: 8, revoked: 9, none: 10 };
    const rows = d.rows.slice().sort((a, b) => (order[a.status.key] ?? 9) - (order[b.status.key] ?? 9) || a.name.localeCompare(b.name));
    $("subs").innerHTML = `<thead><tr><th>School</th><th>Plan</th><th>Status</th><th>Free term</th><th>Paid year</th><th>Invoice</th><th>Actions</th></tr></thead><tbody>${
      rows.length ? rows.map(r => {
        const s = r.sub, inv = s && s.invoice, unpaid = s && s.status !== "cancelled" && !s.paidAt;
        return `<tr>
        <td><b>${esc(r.name)}</b>${r.contact ? `<span class="sub">${esc(r.contact.name)}${r.contact.role ? ", " + esc(r.contact.role) : ""}</span>` : ""}${r.email ? `<span class="sub">${esc(r.email)}</span>` : ""}${r.urn ? `<span class="sub">URN ${esc(r.urn)}</span>` : ""}<span class="sub">id ${esc(r.id)} · joined ${day(r.createdAt)}</span></td>
        <td>${esc(TIER[r.tier] || r.tier)}</td>
        <td><span class="state state-${STATE_CLASS[r.status.key] || "active"}">${esc(r.status.label)}</span></td>
        <td>${r.trialEndsAt ? `until ${ymd(before(r.trialEndsAt))}` : "–"}</td>
        <td>${s ? `${ymd(s.periodStart)} to ${ymd(before(s.periodEnd))}${s.billing ? `<span class="sub">Invoice to ${esc(s.billing.name)}, ${esc(s.billing.email)}</span>${s.billing.po ? `<span class="sub">Purchase order ${esc(s.billing.po)}</span>` : ""}` : ""}` : "–"}</td>
        <td>${inv ? `<a href="/invoice/${encodeURIComponent(inv.number)}" target="_blank" rel="noopener">${esc(inv.number)}</a><span class="sub">${gbp(inv.total)} · due ${ymd(inv.dueAt)}</span>${s.paidAt ? `<span class="sub">Paid ${ymd(s.paidAt)}</span>` : ""}` : s && s.status !== "cancelled" ? `<span class="sub">Not sent yet</span>` : "–"}</td>
        <td><div class="acts">
          ${s && s.status !== "cancelled" ? `<button class="btn" data-bill="send-invoice" data-id="${r.id}">${I("mail", 16)}${inv ? "Resend invoice" : "Send invoice"}</button>` : ""}
          ${unpaid ? `<button class="btn" data-bill="mark-paid" data-id="${r.id}" data-name="${esc(r.name)}">${I("circle-check", 16)}Mark paid</button>` : ""}
          ${s && s.paidAt ? `<button class="btn" data-bill="mark-unpaid" data-id="${r.id}">Mark unpaid</button>` : ""}
          <button class="btn" data-bill="set-trial" data-id="${r.id}" data-name="${esc(r.name)}" data-cur="${esc(r.trialEndsAt ? before(r.trialEndsAt) : "")}">${I("calendar-check", 16)}Free term</button>
          ${s && s.status !== "cancelled" ? `<button class="btn" data-bill="cancel" data-id="${r.id}" data-name="${esc(r.name)}">${I("x", 16)}Cancel</button>` : ""}
        </div></td></tr>`;
      }).join("") : `<tr class="empty-row"><td colspan="7">No schools have signed up yet. The sign-up page is ${esc(SITE)}/signup.html.</td></tr>`
    }</tbody>`;
    const TS = { requested: ["expired", "Waiting for approval"], approved: ["active", "Approved"], declined: ["revoked", "Declined"] };
    $("topups").innerHTML = `<thead><tr><th>School</th><th>Asked</th><th>Pack</th><th>Invoice to</th><th>Status</th><th>Actions</th></tr></thead><tbody>${
      d.topups.length ? d.topups.map(t => `<tr>
        <td><b>${esc(t.school)}</b></td><td>${day(t.at)}</td>
        <td>${t.credited || t.requests} requests · ${gbp(t.price)}</td>
        <td>${t.billing ? `${esc(t.billing.name)}<span class="sub">${esc(t.billing.email)}</span>${t.billing.po ? `<span class="sub">Purchase order ${esc(t.billing.po)}</span>` : ""}` : "–"}</td>
        <td><span class="state state-${TS[t.status][0]}">${TS[t.status][1]}</span>${t.invoice ? `<span class="sub"><a href="/invoice/${encodeURIComponent(t.invoice.number)}" target="_blank" rel="noopener">${esc(t.invoice.number)}</a> · ${t.paidAt ? "paid " + ymd(t.paidAt) : "due " + ymd(t.invoice.dueAt)}</span>` : ""}${t.reason ? `<span class="sub">${esc(t.reason)}</span>` : ""}</td>
        <td><div class="acts">${t.status === "requested" ? `<button class="btn primary" data-tu="approve" data-id="${t.codeId}" data-tid="${t.id}" data-n="${t.requests}" data-price="${t.price}" data-name="${esc(t.school)}">${I("circle-check", 16)}Approve and add</button><button class="btn" data-tu="decline" data-id="${t.codeId}" data-tid="${t.id}" data-name="${esc(t.school)}">${I("x", 16)}Decline</button>`
          : t.status === "approved" && t.invoice && !t.paidAt ? `<button class="btn" data-tu="paid" data-id="${t.codeId}" data-tid="${t.id}" data-name="${esc(t.school)}">${I("circle-check", 16)}Mark paid</button>` : ""}</div></td></tr>`).join("")
        : `<tr class="empty-row"><td colspan="6">No requests yet. Schools can buy more AI requests once ${10} or fewer are left.</td></tr>`}</tbody>`;
    $("enqBox").hidden = !d.enquiries.length; $("enqN").textContent = d.enquiries.length;
    $("enq").innerHTML = d.enquiries.map(q => `<li><time datetime="${esc(q.at)}">${esc(when(q.at))}</time><span><b>${esc(q.trust)}</b>${q.schools ? ` (${esc(q.schools)} schools)` : ""}: ${esc(q.name)}${q.role ? ", " + esc(q.role) : ""}, <a href="mailto:${esc(q.email)}">${esc(q.email)}</a>${q.message ? `<br><span class="muted">${esc(q.message)}</span>` : ""}</span></li>`).join("");
  }

  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-tu]"); if (!b) return;
    const { tu, id, tid, name } = b.dataset;
    let body = {};
    if (tu === "approve") {
      const n = prompt(`How many AI requests should ${name} get? (They asked for ${b.dataset.n}.)`, b.dataset.n); if (n === null) return;
      const pr = prompt(`Price to invoice, in pounds (the pack price is £${b.dataset.price}). Enter 0 for no invoice.`, b.dataset.price); if (pr === null) return;
      body = { requests: n.trim(), price: pr.trim() };
    }
    if (tu === "decline") { const r = prompt(`Reason for declining ${name}'s request (included in the email):`, ""); if (r === null) return; body = { reason: r }; }
    if (tu === "paid") { const v = prompt(`Date ${name}'s payment arrived (YYYY-MM-DD):`, new Date().toISOString().slice(0, 10)); if (v === null) return; body = { date: v.trim() }; }
    b.disabled = true;
    try {
      const r = await api("POST", `/codes/${id}/topups/${tid}/${tu}`, body);
      toast(tu === "approve" ? `Added. ${name} now has ${r.credits} extra requests${r.invoice ? "; invoice " + r.invoice + " sent" : ""}` : tu === "decline" ? "Declined" : "Marked paid");
      await load();
    } catch (err) { toast(err.message); b.disabled = false; }
  });
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-bill]"); if (!b) return;
    const { bill, id, name } = b.dataset;
    let body = {};
    if (bill === "mark-paid") {
      const v = prompt(`Date ${name}'s payment arrived (YYYY-MM-DD). A receipt is emailed to the school.`, new Date().toISOString().slice(0, 10));
      if (v === null) return; body = { date: v.trim() };
    }
    if (bill === "set-trial") {
      const v = prompt(`Last day of ${name}'s free term (YYYY-MM-DD). Access pauses after this day unless the school subscribes.`, b.dataset.cur || "");
      if (v === null || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return;
      const nd = new Date(v.trim() + "T12:00:00Z"); nd.setUTCDate(nd.getUTCDate() + 1);
      body = { date: nd.toISOString().slice(0, 10) };
    }
    if (bill === "cancel" && !confirm(`Cancel ${name}'s subscription now? Their access pauses straight away; saved work is kept for the retention period. Cancel or credit the invoice yourself if needed.`)) return;
    b.disabled = true;
    try {
      await api("POST", `/codes/${id}/billing/${bill}`, body);
      toast({ "send-invoice": "Invoice emailed", "mark-paid": "Marked paid, receipt emailed", "mark-unpaid": "Marked unpaid", cancel: "Subscription cancelled", "set-trial": "Free term updated" }[bill]);
      await load();
    } catch (err) { toast(err.message); b.disabled = false; }
  });
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
    $("evalLink").hidden = which !== "console";
    $("consultLink").hidden = which !== "console";
    if (which === "login") setTimeout(() => $("pw").focus(), 50);
  }
  async function copy(text, label) {
    try { await navigator.clipboard.writeText(text); toast(label || "Copied"); }
    catch (e) { toast("Select the text and copy it"); }
  }

  /* ---------- console ---------- */
  async function load() {
    const d = await api("GET", "/overview");
    const s = d.stats, y = d.system, A = d.ai; window.__cur = A.currency;
    const money = v => v == null ? "" : ` · about ${A.currency}${v.toFixed(2)}`;
    const toks = t => t.input + t.output >= 1e6 ? (Math.round((t.input + t.output) / 1e5) / 10) + "M tokens" : Math.round((t.input + t.output) / 1000) + "k tokens";
    $("stats").innerHTML = [
      ["building", s.activeCodes, "Active school codes"], ["login", s.schoolsSignedIn30, "Schools signed in (30 days)"],
      ["users-group", s.workshops30, `Workshops (30 days) · ${s.workshops} in total`], ["users", s.participants, "Staff responses (all workshops)"],
      ["device-floppy", s.schoolsSaving || 0, "Schools with saved self-evaluations"],
      ["sparkles", A.total.requests, `AI requests this month · ${toks(A.total)}${money(A.total.cost)}. Last month ${A.lastMonth.requests}${money(A.lastMonth.cost)}`],
    ].map(([ic, n, l]) => `<div class="stat"><span class="tile">${I(ic, 24)}</span><div><b>${esc(n)}</b><span>${esc(l)}</span></div></div>`).join("");
    $("sys").innerHTML = `<span><i class="dot" style="background:${y.ai ? "var(--met)" : "var(--no)"}"></i>AI ${y.ai ? "connected (" + esc(y.model) + ")" : "not connected: add ANTHROPIC_API_KEY to .env"}</span>
      <span><i class="dot" style="background:${y.accessRequired ? "var(--met)" : "var(--part)"}"></i>${y.accessRequired ? "Access codes required" : "Site open: no codes created yet"}</span>
      <span>Default AI allowance: ${A.defaultLimit == null ? "unlimited" : A.defaultLimit + " requests per school per month"} (resets ${day(A.resetsOn)})</span>
      <span>Node ${esc(y.node)} · up ${esc(y.uptimeHours)} h</span>`;
    const codes = d.codes.slice().sort((a, b) => (a.state === "active" ? 0 : 1) - (b.state === "active" ? 0 : 1) || a.name.localeCompare(b.name));
    $("codes").innerHTML = `<thead><tr><th>School</th><th>Status</th><th>Created</th><th>Expires</th><th>Last signed in</th><th>Saved work</th><th>AI this month</th><th>Workshops</th><th>Actions</th></tr></thead><tbody>${
      codes.length ? codes.map(c => `<tr>
        <td><b>${esc(c.name)}</b>${c.check ? `<span class="checkflag">${I("alert-triangle", 14)}Check this: ${esc(c.check.reasons.join("; "))}</span>` : ""}${c.email ? `<span class="sub">${esc(c.email)}</span>` : ""}${c.notes ? `<span class="sub">${esc(c.notes)}</span>` : ""}<span class="sub">id ${esc(c.id)}</span></td>
        <td><span class="state state-${c.state}">${c.state[0].toUpperCase() + c.state.slice(1)}</span></td>
        <td>${day(c.createdAt)}</td><td>${c.expiresAt ? day(c.expiresAt) : "Never"}</td><td>${c.lastUsedAt ? day(c.lastUsedAt) : "Never"}</td>
        <td>${c.saved ? `${day(c.saved.updatedAt)}<span class="sub">${c.saved.assessed} lines · ${c.saved.actions} actions · ${c.saved.snapshots} snapshots</span>` : `<span class="sub">None yet</span>`}</td>
        <td>${aiCell(c.ai)}</td>
        <td class="num">${c.workshops}${c.participants ? `<span class="sub">${c.participants} staff</span>` : ""}</td>
        <td><div class="acts">${c.check ? `<button class="btn" data-act="checked" data-id="${c.id}">${I("circle-check", 16)}Looks fine</button>` : ""}${c.state === "revoked"
          ? `<button class="btn" data-act="reactivate" data-id="${c.id}">${I("refresh", 16)}Reactivate</button>`
          : `<button class="btn" data-act="revoke" data-id="${c.id}" data-name="${esc(c.name)}">${I("x", 16)}Revoke</button>`}
          <button class="btn" data-act="allowance" data-id="${c.id}" data-name="${esc(c.name)}" data-cur="${c.ai.limit == null ? "unlimited" : c.ai.limit}">${I("sparkles", 16)}AI allowance</button>
          <button class="btn" data-act="credits" data-id="${c.id}" data-name="${esc(c.name)}" data-cur="${c.ai.credits || 0}">${I("sparkles", 16)}Extra AI requests</button>
          <button class="btn" data-act="extend" data-id="${c.id}" data-days="365">${I("calendar-check", 16)}+1 year</button>
          ${!c.tier && c.state !== "revoked" ? `<button class="btn" data-act="plan" data-id="${c.id}" data-name="${esc(c.name)}">${I("receipt", 16)}Put on a plan</button>` : ""}
          ${c.expiresAt ? `<button class="btn" data-act="extend" data-id="${c.id}" data-days="0">No expiry</button>` : ""}
          ${c.saved || c.workshops ? `<button class="btn" data-act="erase" data-id="${c.id}" data-name="${esc(c.name)}">${I("trash", 16)}Delete data</button>` : ""}
          <button class="btn danger" data-act="delete" data-id="${c.id}" data-name="${esc(c.name)}">${I("trash", 16)}Delete school</button></div></td>
      </tr>`).join("") : `<tr class="empty-row"><td colspan="9">No school codes yet. Create the first one above.</td></tr>`
    }</tbody>`;
    await loadBilling().catch(e => { $("billSys").textContent = e.message; });
    $("actCount").textContent = d.audit.length ? `(latest ${d.audit.length})` : "";
    $("audit").innerHTML = d.audit.length ? d.audit.map(a => `<li><time datetime="${esc(a.at)}">${esc(when(a.at))}</time><span class="${a.action === "admin.login_failed" ? "fail" : ""}">${esc(ACTION[a.action] || a.action)}${a.detail ? ": " + esc(a.detail) : ""} <span class="muted small">(${esc(a.ip)})</span></span></li>`).join("") : `<li><span class="muted">Nothing yet.</span></li>`;
  }

  function aiCell(a) {
    const lim = a.limit == null ? "unlimited" : a.limit === 0 ? "AI off" : a.limit;
    const pct = a.limit ? Math.min(100, Math.round(a.used / a.limit * 100)) : 0;
    const col = a.limit === 0 ? "var(--na)" : a.limit && a.used >= a.limit ? "var(--no)" : pct >= 80 ? "var(--part)" : "var(--met)";
    return `<b style="color:${col}">${a.used}</b> / ${esc(lim)}${a.custom ? "" : ` <span class="sub" style="display:inline">(default)</span>`}
      ${a.limit ? `<span class="meter" aria-hidden="true"><span style="width:${pct}%;background:${col}"></span></span>` : ""}
      <span class="sub">${a.input + a.output ? Math.round((a.input + a.output) / 1000) + "k tokens" : "no tokens"}${a.cost != null ? ` · about ${esc(window.__cur || "$")}${a.cost.toFixed(2)}` : ""} · last month ${a.lastMonth}</span>${a.credits ? `<span class="sub"><b>+${a.credits} extra bought</b></span>` : ""}`;
  }

  $("codes").addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const { act, id } = b.dataset;
    if (act === "credits") {
      const v = prompt(`${b.dataset.name} has ${b.dataset.cur} extra AI requests (bought, used after the monthly allowance).\n\nHow many to add? Use a minus number to take some away.`, "");
      if (v === null || !v.trim()) return;
      b.disabled = true;
      try { const st = await api("POST", `/codes/${id}/credits`, { add: v.trim() }); toast(`${b.dataset.name} now has ${st.credits} extra AI requests`); await load(); }
      catch (err) { toast(err.message); b.disabled = false; }
      return;
    }
    if (act === "allowance") {
      const v = prompt(`AI requests per month for ${b.dataset.name} (currently ${b.dataset.cur}).\n\nEnter a number, 0 to switch AI off for this school, "unlimited", or leave blank to use the default.`, "");
      if (v === null) return;
      b.disabled = true;
      try { const st = await api("POST", `/codes/${id}/allowance`, { limit: v.trim() === "" ? null : v.trim() }); toast(st.limit == null ? "AI unlimited for this school" : st.limit === 0 ? "AI switched off for this school" : `Allowance set to ${st.limit} a month`); await load(); }
      catch (err) { toast(err.message); b.disabled = false; }
      return;
    }
    if (act === "plan") {
      const tier = (prompt(`Plan for ${b.dataset.name}: type independent, primary or secondary.`, "primary") || "").trim().toLowerCase();
      if (!["independent", "primary", "secondary"].includes(tier)) return;
      const v = prompt("Last day of the free term (YYYY-MM-DD). After this, the school is asked to subscribe.", "");
      if (v === null || !/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return;
      const nd = new Date(v.trim() + "T12:00:00Z"); nd.setUTCDate(nd.getUTCDate() + 1);
      b.disabled = true;
      try { await api("POST", `/codes/${id}/billing/set-trial`, { date: nd.toISOString().slice(0, 10), tier }); toast("Plan set"); await load(); }
      catch (err) { toast(err.message); b.disabled = false; }
      return;
    }
    if (act === "delete") {
      const typed = prompt(`Delete ${b.dataset.name} completely?\n\nThis removes the school's access code (it stops working at once), its sign-up and contact details, subscription record, saved self-evaluation, action plan, snapshots and workshops. It can't be undone (backups expire within 90 days). Invoices already issued are kept for your accounts.\n\nType the school's name to confirm:`);
      if (typed === null) return;
      if (typed.trim().toLowerCase() !== b.dataset.name.trim().toLowerCase()) { toast("The name didn't match, so nothing was deleted."); return; }
      b.disabled = true;
      try { await api("POST", `/codes/${id}/delete`, { confirm: typed }); toast(`${b.dataset.name} deleted`); await load(); }
      catch (err) { toast(err.message); b.disabled = false; }
      return;
    }
    if (act === "erase") {
      const typed = prompt(`This permanently deletes ${b.dataset.name}'s saved self-evaluation, action plan, snapshots and workshops. It can't be undone (backups expire within 90 days).\n\nType DELETE to confirm.`);
      if (typed !== "DELETE") return;
      b.disabled = true;
      try { const r = await api("POST", `/codes/${id}/erase`, {}); toast(`Deleted${r.erased ? " saved work" : ""}${r.workshops ? ` and ${r.workshops} workshop${r.workshops === 1 ? "" : "s"}` : ""}`); await load(); }
      catch (err) { toast(err.message); b.disabled = false; }
      return;
    }
    if (act === "revoke" && !b.dataset.confirm) {
      b.dataset.confirm = "1"; b.innerHTML = `${I("alert-triangle", 16)}Click again to revoke`; b.classList.add("danger");
      setTimeout(() => { if (b.isConnected) { delete b.dataset.confirm; b.innerHTML = `${I("x", 16)}Revoke`; b.classList.remove("danger"); } }, 4000);
      return;
    }
    b.disabled = true;
    try {
      await api("POST", `/codes/${id}/${act}`, act === "extend" ? { days: Number(b.dataset.days) } : {});
      toast({ revoke: "Code revoked. It stops working straight away.", reactivate: "Code reactivated", extend: "Expiry updated", checked: "Marked as looking fine" }[act]);
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
  // Recent activity: collapsed by default; remember the choice on this device
  try { $("actBox").open = localStorage.getItem("hwwd-admin-activity") === "open"; } catch (e) {}
  $("actBox").addEventListener("toggle", () => { try { localStorage.setItem("hwwd-admin-activity", $("actBox").open ? "open" : "closed"); } catch (e) {} });
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
