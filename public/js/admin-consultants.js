/* Superadmin: consultant applications, checks, approval, fees and listings. */
(function () {
  const $ = id => document.getElementById(id);
  const I = window.HWWD.icon;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const day = d => d ? new Date(String(d).length === 10 ? d + "T12:00:00Z" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "–";
  const todayIso = () => new Date().toISOString().slice(0, 10);
  function toast(m) { const t = $("toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("on"), 2600); }
  async function api(method, path, body) {
    const r = await fetch("api/admin" + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { $("console").classList.add("hide"); $("signedOut").classList.remove("hide"); throw new Error("Sign in again."); }
    if (!r.ok) throw new Error(d.error || "Something went wrong.");
    return d;
  }
  let data = null, filter = "todo";
  const EXP = {};

  async function load() {
    data = await api("GET", "/consultants");
    data.expertise.forEach(([id, l]) => { EXP[id] = l; });
    $("feeL").textContent = data.fees.listing;
    const L = data.list, n = k => L.filter(c => c.state.key === k).length;
    $("stats").innerHTML = [["clipboard-list", n("applied"), "Applications to check"], ["receipt", n("approved"), "Approved, fee to pay"], ["circle-check", L.filter(c => c.visible).length, "Live and visible to schools"],
      ["alert-triangle", n("hidden"), "Hidden (insurance or annual check)"], ["mail", L.reduce((t, c) => t + c.enquiries, 0), "Enquiries from schools"]]
      .map(([ic, v, l]) => `<div class="stat"><span class="tile">${I(ic, 22)}</span><div><b>${esc(v)}</b><span>${esc(l)}</span></div></div>`).join("");
    render();
  }
  const needsAction = c => ["applied", "approved", "hidden"].includes(c.state.key) || c.pending || (c.fees.annual && c.fees.annual.number && !c.fees.annual.paidAt);
  function render() {
    const L = data.list.filter(c => filter === "all" || (filter === "live" ? c.visible : needsAction(c)));
    $("list").innerHTML = L.length ? L.map(card).join("") : `<div class="cadm"><p class="muted">${filter === "todo" ? "Nothing needs your attention." : "No consultants here yet."}</p></div>`;
  }
  function card(c) {
    const p = c.profile, done = k => c.checks[k] && c.checks[k].at, live = c.status === "live";
    const checks = data.checks.map(([k, label]) => `
      <div class="ccheck${done(k) ? " done" : ""}">
        <span>${I(done(k) ? "circle-check" : "circle-minus", 18)} <b>${esc(label)}</b>${done(k) ? ` · checked ${day(c.checks[k].at)}${c.checks[k].note ? ` (${esc(c.checks[k].note)})` : ""}` : " · not yet"}</span>
        <label class="small">Date <input type="date" data-date="${k}" value="${todayIso()}" max="${todayIso()}"></label>
        ${k === "insurance" ? `<label class="small">Insured until <input type="date" data-exp value="${esc(c.insurance && c.insurance.expires)}"></label>` : ""}
        <label class="small">Note <input type="text" data-note="${k}" maxlength="200" placeholder="${k === "dbs" ? "e.g. certificate seen, status current" : "optional"}"></label>
        <button class="btn" data-act="check" data-check="${k}" data-id="${c.id}">${I("circle-check", 16)}${done(k) ? "Re-record" : "Record"}</button>
      </div>`).join("");
    const L = c.fees.listing, A = c.fees.annual;
    const acts = [];
    if (c.status === "applied") acts.push(`<button class="btn primary" data-act="approve" data-id="${c.id}">${I("circle-check", 16)}Approve and send £${data.fees.listing} invoice</button>`, `<button class="btn" data-act="reject" data-id="${c.id}">${I("x", 16)}Reject</button>`);
    if (c.status === "approved") acts.push(`<button class="btn primary" data-act="listing-paid" data-id="${c.id}">${I("circle-check", 16)}Listing fee paid: go live</button>`, `<button class="btn" data-act="send-invoice" data-kind="listing" data-id="${c.id}">${I("mail", 16)}${L && L.number ? "Resend" : "Send"} listing invoice</button>`);
    if (live) acts.push(`<button class="btn" data-act="annual-done" data-id="${c.id}">${I("calendar-check", 16)}Annual check done (fee paid)</button>`, `<button class="btn" data-act="send-invoice" data-kind="annual" data-id="${c.id}">${I("mail", 16)}${A && A.number ? "Resend" : "Send"} £${data.fees.annual} annual invoice</button>`);
    if (c.status === "live" || c.status === "approved") acts.push(`<button class="btn" data-act="suspend" data-id="${c.id}">${I("alert-triangle", 16)}Suspend</button>`);
    if (c.status === "suspended") acts.push(`<button class="btn" data-act="approve" data-id="${c.id}">${I("refresh", 16)}Reinstate</button>`);
    acts.push(`<button class="btn" data-act="send-link" data-id="${c.id}">${I("link", 16)}Email their private link</button>`, `<button class="btn" data-act="delete" data-id="${c.id}" data-name="${esc(p.name)}">${I("trash", 16)}Delete</button>`);
    return `<article class="cadm" aria-labelledby="h-${c.id}">
      <h2 id="h-${c.id}">${esc(p.name)} <span class="state state-${c.visible ? "active" : c.status === "rejected" || c.status === "suspended" ? "revoked" : "expired"}">${esc(c.state.label)}</span>${c.enquiries ? `<span class="muted small">${c.enquiries} enquir${c.enquiries === 1 ? "y" : "ies"}</span>` : ""}</h2>
      <p style="margin:0"><b>${esc(p.headline)}</b></p>
      <div class="grid2">
        <p><b>Contact</b><a href="mailto:${esc(c.contact.email)}">${esc(c.contact.email)}</a>${c.contact.phone ? ` · ${esc(c.contact.phone)}` : ""}</p>
        <p><b>Location</b>${esc(p.town)} (${esc(p.district)}), ${esc(p.region)} · travels ${p.travel} miles${p.remote ? " · remote" : ""}</p>
        <p><b>Invoice address</b>${esc(c.contact.address || "").replace(/\n/g, ", ")}</p>
        <p><b>TRN</b>${esc(c.trn || "not given")} · <b style="display:inline">Update Service</b> ${c.updateService ? "yes" : "no"}</p>
        <p><b>Insurance</b>${esc(c.insurance && c.insurance.provider)}, until ${day(c.insurance && c.insurance.expires)}</p>
        <p><b>Referees</b>${(c.referees || []).map(r => `${esc(r.name)}, ${esc(r.role)} &lt;<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>&gt;`).join("<br>")}</p>
        <p><b>Expertise</b>${p.expertise.map(x => esc(EXP[x] || x)).join(", ")}</p>
        <p><b>Fees</b>Listing: ${L && L.paidAt ? "paid " + day(L.paidAt) : L && L.number ? `<a href="/invoice/${esc(L.number)}" target="_blank" rel="noopener">${esc(L.number)}</a> unpaid` : "not invoiced"}${c.checksDue ? ` · annual check due ${day(c.checksDue)}` : ""}${A && A.number ? ` · <a href="/invoice/${esc(A.number)}" target="_blank" rel="noopener">${esc(A.number)}</a> ${A.paidAt ? "paid" : "unpaid"}` : ""}</p>
        <p><b>Applied</b>${day(c.createdAt)}${c.liveAt ? ` · live since ${day(c.liveAt)}` : ""}</p>
      </div>
      <details><summary>Bio, background and qualifications</summary><p class="bio">${esc(p.bio)}</p><p class="small">${esc(p.background)}${p.qualifications ? " · " + esc(p.qualifications) : ""}</p></details>
      ${c.pending ? `<div class="pending"><b>Changes waiting for review</b> (${day(c.pending.at)})<p><b>Summary:</b> ${esc(c.pending.profile.headline)}</p><p><b>Bio:</b> ${esc(c.pending.profile.bio)}</p><p><b>Location:</b> ${esc(c.pending.profile.town)} (${esc(c.pending.profile.district)}), travels ${c.pending.profile.travel} miles · <b>Expertise:</b> ${c.pending.profile.expertise.map(x => esc(EXP[x] || x)).join(", ")}</p>
        <div class="acts"><button class="btn primary" data-act="approve-changes" data-id="${c.id}">Publish changes</button><button class="btn" data-act="reject-changes" data-id="${c.id}">Don't publish</button></div></div>` : ""}
      ${c.status === "rejected" ? "" : `<div class="cchecks" aria-label="Checks">${checks}</div>`}
      <div class="acts">${acts.join("")}</div>
    </article>`;
  }

  document.addEventListener("click", async e => {
    const f = e.target.closest("[data-f]");
    if (f) { filter = f.dataset.f; document.querySelectorAll("[data-f]").forEach(b => b.setAttribute("aria-pressed", String(b === f))); render(); return; }
    const b = e.target.closest("[data-act]"); if (!b) return;
    const { act, id } = b.dataset, art = b.closest("article");
    let body = {};
    if (act === "check") {
      const k = b.dataset.check;
      body = { check: k, date: art.querySelector(`[data-date="${k}"]`).value, note: art.querySelector(`[data-note="${k}"]`).value };
      if (k === "insurance") body.expires = art.querySelector("[data-exp]").value;
    }
    if (act === "reject" || act === "suspend" || act === "reject-changes") {
      const r = prompt(act === "reject" ? "Reason for not approving (it's included in the email to the consultant):" : act === "suspend" ? "Reason for suspending (included in the email):" : "Optional note to the consultant about why:");
      if (r === null) return; body = { reason: r };
    }
    if (act === "listing-paid" || act === "annual-done") {
      const v = prompt("Date the payment arrived (YYYY-MM-DD):", todayIso()); if (v === null) return; body = { date: v.trim() };
    }
    if (act === "send-invoice") body = { kind: b.dataset.kind };
    if (act === "delete" && prompt(`Type DELETE to remove ${b.dataset.name} and all their details.`) !== "DELETE") return;
    b.disabled = true;
    try {
      await api("POST", `/consultants/${id}/${act}`, body);
      toast({ check: "Check recorded", approve: "Approved", "listing-paid": "Listing is live", "annual-done": "Annual check recorded", reject: "Rejected", suspend: "Suspended", "approve-changes": "Changes published", "reject-changes": "Changes not published", "send-invoice": "Invoice emailed", "send-link": "Link emailed", delete: "Deleted" }[act] || "Done");
      await load();
    } catch (err) { toast(err.message); b.disabled = false; }
  });
  $("refresh").onclick = () => load().then(() => toast("Up to date")).catch(e => toast(e.message));
  load().then(() => $("console").classList.remove("hide")).catch(() => $("signedOut").classList.remove("hide"));
})();
