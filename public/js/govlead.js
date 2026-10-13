/*
 * Evalu8 Compass — governors and trustees, for leaders (in the Reports tab):
 * the headteacher's termly report (drafted from live data, frozen when issued),
 * the challenge log, and the governors' read-only code.
 */
(function (root) {
  const BR = root.HWWD.briefs, C = root.HWWD.checks, L = root.HWWD.leaders;
  let H, I, esc, el, P;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const today = () => new Date().toISOString().slice(0, 10);
  const st = () => H.state();
  const reports = () => st().govReports || (st().govReports = []);
  const chals = () => st().challenges || (st().challenges = []);
  const nice = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
  let access = null, newCode = "", showAll = false, viewRep = null;

  const issued = () => reports().filter(r => r.status === "issued" && r.doc).sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
  function current() {
    const tm = C.term(today());
    return { tm, draft: reports().find(r => r.term === tm.key && r.status === "draft"), last: issued()[0] || null, thisTerm: issued().find(r => r.term === tm.key) || null };
  }
  function build(draft) {
    const { last } = current();
    return BR.govReport(st(), H.view(), { commentary: draft ? draft.commentary : "", prev: last && last.doc.scores, since: last ? last.issuedAt.slice(0, 10) : undefined });
  }
  const headName = () => { const h = (st().team || []).find(m => m.role === "head"); return h ? h.name : ""; };
  const govCount = () => (st().team || []).filter(m => ["gov", "trustee"].includes(m.role) && L.validEmail(m.email)).length;

  function render() {
    const box = el("govBox"); if (!box) return;
    const { tm, draft, thisTerm } = current();
    const open = chals().filter(c => c.status === "open");
    const list = chals().slice().sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || String(b.createdAt).localeCompare(String(a.createdAt)));
    const shown = showAll ? list : list.filter(c => c.status !== "closed").slice(0, 12);
    const areas = H.view(), areaName = id => (areas.find(a => a.id === id) || {}).name || "";
    box.innerHTML = `<h2 class="gov-h">${I("building-community", 22)}Governors and trustees</h2>
    <div class="gov-grid">
      <section class="gov-card" aria-labelledby="gRepH">
        <h3 id="gRepH">${I("file-text", 18)}Termly report: ${esc(tm.name)}</h3>
        ${thisTerm && !draft ? `<p class="small">Issued ${esc(nice(thisTerm.issuedAt))}${thisTerm.sentAt ? ", emailed " + esc(nice(thisTerm.sentAt)) : ""}. Governors can read it in their view.</p>
          <div class="row"><button class="btn" type="button" data-gview="${thisTerm.id}">${I("eye", 16)}Read it</button><button class="btn" type="button" data-gsend="${thisTerm.id}"${govCount() ? "" : " disabled"}>${I("mail", 16)}Email to governors</button><button class="btn" type="button" data-gredraft="1">${I("refresh", 16)}Write an updated report</button></div>`
        : `<p class="small">Written for you from the self-evaluation, plan, monitoring and leaders' figures, with no information about individual pupils. Add your commentary, check it, then issue it: governors see the issued copy, which doesn't change.</p>
          <div class="field"><label for="gCom">From the headteacher</label><textarea id="gCom" rows="5" data-gcom="1" placeholder="The headlines this term: what's going well, what isn't yet, and what you need from the board.">${esc(draft ? draft.commentary : "")}</textarea></div>
          <details class="paper-doc"${viewRep === "draft" ? " open" : ""} data-gdet="draft"><summary>${I("file-text", 16)}Read the report</summary><div class="lead-preview" id="gPrev">${H.renderDoc(build(draft))}</div></details>
          <div class="row"><button class="btn primary" type="button" data-gissue="1">${I("circle-check", 16)}Issue to governors</button><button class="btn" type="button" data-gprint="gPrev">${I("file-export", 16)}Print or save as PDF</button></div>`}
        ${viewRep && viewRep !== "draft" ? (() => { const r = issued().find(x => x.id === viewRep); return r ? `<div class="lead-preview" id="gIss">${H.renderDoc(r.doc)}</div><div class="row"><button class="btn" type="button" data-gprint="gIss">${I("file-export", 16)}Print or save as PDF</button><button class="btn" type="button" data-gview="">Close</button></div>` : ""; })() : ""}
        ${issued().length > (thisTerm ? 1 : 0) ? `<details class="past"><summary>Earlier reports (${issued().length - (thisTerm ? 1 : 0)})</summary><ul class="gov-past">${issued().filter(r => r !== thisTerm).map(r => `<li><button class="linkbtn" type="button" data-gview="${r.id}">${esc(r.doc.title)}</button> <span class="small">issued ${esc(nice(r.issuedAt))}</span></li>`).join("")}</ul></details>` : ""}
      </section>

      <section class="gov-card" aria-labelledby="gAccH">
        <h3 id="gAccH">${I("key", 18)}Governors' access</h3>
        ${access === null ? `<p class="small">Checking…</p>` : access.on ? `<p class="small">On since ${esc(nice(access.at))}. Governors and trustees sign in with their own code to read issued reports, see the school today and ask questions. They can't change anything.</p>`
          : `<p class="small">Give governors and trustees their own read-only code. They can read issued reports, see where the school stands today and ask questions; they can't change anything.</p>`}
        ${newCode ? `<div class="code-once" role="status"><span>The governors' code (shown once):</span><b>${esc(newCode)}</b></div>` : ""}
        ${access !== null ? `<label class="switch"><input type="checkbox" id="gEmailCode"${govCount() ? " checked" : " disabled"}> Email it to the governors and trustees in the Team tab (${govCount()} with an email address)</label>
        <div class="row"><button class="btn${access.on ? "" : " primary"}" type="button" data-gcode="new">${I("key", 16)}${access.on ? "Replace the code" : "Create a governors' code"}</button>
          ${access.on ? `<button class="btn" type="button" data-gcode="off">${I("lock", 16)}Switch off</button>` : ""}
          <a class="btn" href="governors.html">${I("eye", 16)}See what governors see</a></div>` : ""}
      </section>
    </div>

    <section class="gov-card gov-chal" aria-labelledby="gChH">
      <div class="sg-head"><h3 id="gChH">${I("message-circle", 18)}Challenge log</h3><span class="sg-count${open.length ? "" : " all"}">${open.length} waiting for an answer</span></div>
      <p class="small">Questions from governors and trustees, and the challenge they give in meetings and visits, with leaders' answers. Ofsted looks for governors holding leaders to account: this is the record. Answers are shown to governors and included in the next termly report.</p>
      ${shown.map(c => `<article class="chal ${c.status}" data-cid="${c.id}" aria-label="Question from ${esc(c.by || "a governor")}">
        <div class="chal-top"><span class="chip-st st-${c.status}">${{ open: "Waiting for an answer", answered: "Answered", closed: "Closed" }[c.status]}</span><span class="small">${esc(c.by || "")}${c.asked ? " · " + esc(nice(c.asked)) : ""}${c.areaId ? " · " + esc(areaName(c.areaId)) : ""}${c.source === "school" ? " · recorded by leaders" : ""}</span></div>
        <p class="chal-q">${esc(c.question)}</p>
        ${c.status === "closed" ? (c.response ? `<div class="chal-a"><b>Answer:</b> ${esc(c.response)}</div>` : "") : `<div class="field"><label for="cr-${c.id}">Leaders' answer</label><textarea id="cr-${c.id}" data-cres="${c.id}" rows="3">${esc(c.response || "")}</textarea></div>
        <div class="row">${c.status === "open" ? `<button class="btn primary" type="button" data-cans="${c.id}">${I("circle-check", 16)}Send the answer</button>` : `<span class="small">Answered ${esc(nice(c.respondedAt))}${c.respondedBy ? " by " + esc(c.respondedBy) : ""}</span>`}
          ${c.actionId ? `<span class="small">${I("target", 14)} In the plan</span>` : `<button class="btn" type="button" data-cact="${c.id}">${I("target", 16)}Make it an action</button>`}
          <button class="btn" type="button" data-cclose="${c.id}">Close</button></div>`}
      </article>`).join("") || `<p class="small">No questions yet. Governors' questions arrive here, and the head and deputy are emailed straight away.</p>`}
      ${list.length > shown.length || showAll ? `<button class="linkbtn" type="button" data-callx="1">${showAll ? "Show fewer" : `Show all ${list.length}, including closed`}</button>` : ""}
      <details class="paper-doc"><summary>${I("list-check", 16)}Record challenge from a meeting or visit</summary>
        <div class="gov-ask-grid"><div class="field"><label for="cNewBy">Asked by</label><input id="cNewBy" placeholder="e.g. Chair of governors" autocomplete="off"></div>
        <div class="field"><label for="cNewArea">About</label><select id="cNewArea"><option value="">Any area</option>${areas.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
        <div class="field"><label for="cNewDate">Date</label><input type="date" id="cNewDate" value="${today()}"></div></div>
        <div class="field"><label for="cNewQ">The question or challenge</label><textarea id="cNewQ" rows="2"></textarea></div>
        <button class="btn" type="button" data-cnew="1">${I("message-circle", 16)}Add to the log</button>
      </details>
    </section>`;
  }

  async function loadAccess() {
    try { const r = await fetch("api/access"); const d = await r.json(); access = d.gov || { on: false }; } catch (e) { access = { on: false }; }
    render();
  }
  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({})); return { ok: r.ok, d };
  }
  function print(id) { const p = el(id); if (!p) return; document.body.classList.add("print-doc"); p.classList.add("printing"); window.print(); setTimeout(() => { document.body.classList.remove("print-doc"); p.classList.remove("printing"); }, 500); }

  function onClick(e) {
    const b = e.target.closest("button"); if (!b || !el("govBox") || !el("govBox").contains(b)) return false;
    const d = b.dataset, find = id => chals().find(c => c.id === id);
    if (d.gprint) { if (d.gprint === "gPrev") { const det = b.closest(".gov-card").querySelector("details"); if (det) det.open = true; } print(d.gprint); return true; }
    if ("gview" in d) { viewRep = d.gview || null; render(); return true; }
    if (d.gissue) {
      const { tm, draft } = current();
      if (!confirm("Issue this report to governors? They'll see this version, which won't change. You can email it to them next.")) return true;
      const doc = build(draft);
      const rep = draft || { id: uid(), term: tm.key, commentary: "" };
      Object.assign(rep, { status: "issued", issuedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), doc });
      if (!draft) reports().push(rep);
      H.save(); viewRep = null; render(); H.toast(govCount() ? "Issued. Now email it to governors." : "Issued. Add governors in the Team tab to email it.");
      const s = document.querySelector(`[data-gsend="${rep.id}"]`); if (s && !s.disabled) s.focus();
      return true;
    }
    if (d.gredraft) { const { tm, thisTerm } = current(); reports().push({ id: uid(), term: tm.key, commentary: thisTerm ? thisTerm.commentary || "" : "", status: "draft", updatedAt: new Date().toISOString() }); H.save(); render(); el("gCom").focus(); return true; }
    if (d.gsend) {
      b.disabled = true;
      H.flush().then(() => post(`api/school/govreports/${d.gsend}/send`)).then(({ ok, d: r }) => {
        if (ok) { const rep = reports().find(x => x.id === d.gsend); if (rep) { rep.sentAt = new Date().toISOString(); H.save(); render(); } }
        H.toast(ok ? `Report emailed to ${r.sent} ${r.sent === 1 ? "person" : "people"}` : r.error || "That didn't send.");
      }).catch(() => H.toast("Couldn't reach the server. Try again.")).finally(() => { b.disabled = false; });
      return true;
    }
    if (d.gcode) {
      if (d.gcode === "off" && !confirm("Switch off governors' access? Governors will be signed out and their code will stop working.")) return true;
      if (d.gcode === "new" && access && access.on && !confirm("Replace the governors' code? The old code stops working straight away, and governors will need the new one.")) return true;
      b.disabled = true;
      const email = d.gcode === "new" && el("gEmailCode") && el("gEmailCode").checked;
      H.flush().then(() => post("api/school/governors/code", { action: d.gcode, email })).then(({ ok, d: r }) => {
        if (!ok) { H.toast(r.error || "That didn't work."); return; }
        access = { on: r.on, at: r.on ? new Date().toISOString() : null }; newCode = r.code || "";
        render();
        H.toast(!r.on ? "Governors' access switched off" : r.sent ? `Code created and emailed to ${r.sent} ${r.sent === 1 ? "person" : "people"}` : r.mailError ? `Code created, but the email didn't send: ${r.mailError}` : "Code created. Share it with your governors.");
      }).catch(() => H.toast("Couldn't reach the server. Try again.")).finally(() => { b.disabled = false; });
      return true;
    }
    if (d.cans) {
      const c = find(d.cans), t = el("cr-" + c.id);
      if (!c.response || !c.response.trim()) { H.toast("Write the answer first."); t.focus(); return true; }
      c.status = "answered"; c.respondedAt = new Date().toISOString(); c.respondedBy = c.respondedBy || headName();
      H.save(); render(); H.toast("Answered. Governors can see it in their view."); return true;
    }
    if (d.cclose) { const c = find(d.cclose); const prev = c.status; c.status = "closed"; H.save(); render(); H.undo("Question closed", () => { c.status = prev; H.save(); render(); }); return true; }
    if (d.cact) {
      const c = find(d.cact);
      const a = P.add({ title: c.question.slice(0, 140), owner: "", source: "governors", detail: `Challenge from ${c.by || "governors"}${c.asked ? " on " + nice(c.asked) : ""}`, status: "todo" }, true);
      c.actionId = a.id; H.save(); render(); P.render(); H.toast("Added to the improvement plan. Give it an owner and date there."); return true;
    }
    if (d.callx) { showAll = !showAll; render(); return true; }
    if (d.cnew) {
      const q = el("cNewQ").value.trim(), by = el("cNewBy").value.trim();
      if (q.length < 5) { H.toast("Write the question first."); el("cNewQ").focus(); return true; }
      chals().push({ id: uid(), asked: el("cNewDate").value || today(), by, source: "school", areaId: el("cNewArea").value, question: q, response: "", respondedBy: "", respondedAt: "", status: "open", actionId: "", createdAt: new Date().toISOString() });
      H.save(); render(); H.toast("Added to the challenge log"); return true;
    }
    return false;
  }
  function onInput(e) {
    const t = e.target;
    if (t.dataset.gcom) {
      const { tm, draft } = current();
      const r = draft || (() => { const n = { id: uid(), term: tm.key, commentary: "", status: "draft" }; reports().push(n); return n; })();
      r.commentary = t.value; r.updatedAt = new Date().toISOString(); H.save();
      const p = el("gPrev"); if (p) p.innerHTML = H.renderDoc(build(r));
      return;
    }
    if (t.dataset.cres) { const c = chals().find(x => x.id === t.dataset.cres); if (c) { c.response = t.value; if (c.status === "answered") c.respondedAt = new Date().toISOString(); H.save(); } }
  }
  function init(host) {
    H = host; I = host.icon; esc = host.esc; P = host.plan; el = id => document.getElementById(id);
    document.addEventListener("click", e => { if (onClick(e)) e.stopPropagation(); }, true);
    document.addEventListener("input", onInput);
    document.addEventListener("toggle", e => { if (e.target.dataset && e.target.dataset.gdet) viewRep = e.target.open ? "draft" : null; }, true);
  }
  function show() { if (access === null) loadAccess(); else render(); }
  function isEditing() { const a = document.activeElement; return !!(a && el("govBox") && el("govBox").contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); }
  root.HWWD.govlead = { init, render: show, isEditing };
})(window);
