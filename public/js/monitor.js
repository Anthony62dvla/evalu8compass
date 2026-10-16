/*
 * Evalu8 Compass — the Monitoring tab: plan and record monitoring, including the
 * DSL's termly safeguarding checks. Findings can be added to a checklist line's
 * evidence and turned into actions in the improvement plan.
 */
(function (root) {
  const C = root.HWWD.checks, L = root.HWWD.leaders;
  let H, I, esc, el, P;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const list = () => H.state().monitoring || (H.state().monitoring = []);
  const today = () => new Date().toISOString().slice(0, 10);
  const nice = d => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "No date";
  const opened = new Set();
  let fArea = "", fType = "", showOld = false;

  function areaName(id) { const a = H.view().find(x => x.id === id); return a ? a.name : ""; }
  function dslName() { const d = (H.state().team || []).find(m => m.role === "dsl"); return d ? d.name || "DSL" : "DSL"; }

  function render() {
    const box = el("monList"); if (!box) return;
    const areas = H.view(), sgc = C.sgStatus(H.state(), today());
    const all = list().slice().filter(r => (!fArea || r.areaId === fArea) && (!fType || r.type === fType));
    const planned = all.filter(r => r.status === "planned").sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const doneAll = all.filter(r => r.status === "done").sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const thisTerm = doneAll.filter(r => C.inTerm(r, sgc.term) || !r.date), older = doneAll.filter(r => !thisTerm.includes(r));
    el("monTabCount").textContent = planned.filter(r => r.date && r.date <= today()).length ? ` (${planned.filter(r => r.date && r.date <= today()).length})` : "";
    box.innerHTML = `
      <section class="sg-cycle" aria-labelledby="sgcH">
        <div class="sg-head"><h3 id="sgcH">${I("shield-check", 20)}DSL's safeguarding checks: ${esc(sgc.term.name)}</h3>
          <span class="sg-count${sgc.done === sgc.total ? " all" : ""}">${sgc.done} of ${sgc.total} done</span></div>
        <p class="small">What Ofsted expects leaders to know: that safeguarding works in practice for pupils, not just on paper. Record each check once a term. (The single central record is checked in your MIS.)</p>
        <ul class="sg-list">${sgc.list.map(x => `<li class="${x.rec ? "is-done" : ""}">
          <span class="sg-ico">${I(x.rec ? (x.rec.judge === "concern" ? "alert-triangle" : "circle-check") : "help-circle", 18)}</span>
          <div class="sg-txt"><b>${esc(x.label)}</b>${x.rec ? `<span class="small">Done ${esc(nice(x.rec.date))}${x.rec.by ? " by " + esc(x.rec.by) : ""}${x.rec.judge ? " · " + C.JUDGE[x.rec.judge] : ""}</span>` : `<span class="small">${esc(x.prompt)}</span>`}</div>
          ${x.rec ? `<button class="btn" type="button" data-mopen="${x.rec.id}">View</button>` : `<button class="btn" type="button" data-msg="${x.key}">${I("clipboard-check", 16)}Record</button>`}
        </li>`).join("")}</ul>
      </section>
      <div class="mon-filters">
        <label for="monFA">Area</label><select id="monFA"><option value="">All areas</option>${areas.map(a => `<option value="${a.id}"${fArea === a.id ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
        <label for="monFT">Type</label><select id="monFT"><option value="">All types</option>${C.TYPES.map(([k, l]) => `<option value="${k}"${fType === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      </div>
      <h3 class="mon-h">Planned</h3>
      ${planned.length ? planned.map(card).join("") : `<p class="small">Nothing planned${fArea || fType ? " that matches" : ""}. Use <b>Plan monitoring</b> to put learning walks, work scrutiny and voice activities in the calendar; whoever is carrying it out is reminded in their Monday email.</p>`}
      <h3 class="mon-h">Done this term</h3>
      ${thisTerm.length ? thisTerm.map(card).join("") : `<p class="small">No monitoring recorded this term${fArea || fType ? " that matches" : ""} yet.</p>`}
      ${older.length ? `<details class="past"${showOld ? " open" : ""}><summary>Earlier terms (${older.length})</summary>${older.map(card).join("")}</details>` : ""}`;
    const d = box.querySelector("details.past"); if (d) d.addEventListener("toggle", () => { showOld = d.open; });
  }

  function card(r) {
    const open = opened.has(r.id), areas = H.view(), area = areas.find(a => a.id === r.areaId);
    const late = r.status === "planned" && r.date && r.date < today();
    return `<article class="mon${r.judge === "concern" ? " concern" : ""}${r.status === "planned" ? " planned" : ""}" data-mid="${r.id}" aria-label="${esc(C.title(r))}">
      <button class="mon-sum" type="button" data-mtoggle="${r.id}" aria-expanded="${open}">
        <span class="mon-date">${esc(nice(r.date))}${late ? ` <span class="warn">late</span>` : ""}</span>
        <span class="mon-title"><b>${esc(C.title(r))}</b><span class="small">${esc(C.TYPE[r.type] || "")}${area ? " · " + esc(area.name) : ""}${r.by ? " · " + esc(r.by) : ""}</span></span>
        ${r.judge ? `<span class="judge j-${r.judge}">${C.JUDGE[r.judge]}</span>` : ""}${I("chevron-down", 18, open ? "flip-v" : "")}
      </button>
      ${open ? form(r, areas, area) : ""}
    </article>`;
  }

  function form(r, areas, area) {
    const id = r.id, f = k => `data-mf="${id}|${k}"`;
    const actions = (H.state().actions || []).filter(a => (r.actionIds || []).includes(a.id));
    return `<div class="mon-body">
      <div class="mon-grid">
        <div class="field"><label for="mo-ty-${id}">Type</label><select id="mo-ty-${id}" ${f("type")}>${C.TYPES.map(([k, l]) => `<option value="${k}"${r.type === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
        ${r.type === "sg" ? `<div class="field"><label for="mo-ck-${id}">Which check</label><select id="mo-ck-${id}" ${f("check")}><option value="">Choose…</option>${C.SG_CHECKS.map(([k, l]) => `<option value="${k}"${r.check === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>` : ""}
        <div class="field"><label for="mo-dt-${id}">Date</label><input type="date" id="mo-dt-${id}" ${f("date")} value="${esc(r.date || "")}"></div>
        <div class="field"><label for="mo-by-${id}">Carried out by</label><input id="mo-by-${id}" ${f("by")} value="${esc(r.by || "")}" list="ownerList" autocomplete="off"></div>
        <div class="field"><label for="mo-ar-${id}">Evaluation area</label><select id="mo-ar-${id}" ${f("areaId")}><option value="">Choose…</option>${areas.map(a => `<option value="${a.id}"${r.areaId === a.id ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select></div>
        ${(() => { const SI = root.HWWD.siams, pr = H.state().profile || {}; if (!SI || !SI.isChurch(pr)) return ""; return `<div class="field"><label for="mo-iq-${id}">SIAMS Inspection Question <span class="muted-inline">(optional)</span></label><select id="mo-iq-${id}" ${f("iq")}><option value="">None</option>${SI.iqsFor(pr).map(q => `<option value="${q.id}"${r.iq === q.id ? " selected" : ""}>IQ${q.n}: ${esc(q.short)}</option>`).join("")}</select></div>`; })()}
        ${area ? `<div class="field wide"><label for="mo-ln-${id}">Evidence for which checklist line? <span class="muted-inline">(optional)</span></label><select id="mo-ln-${id}" ${f("lineId")}><option value="">None in particular</option>${area.items.map(i => `<option value="${i.id}"${r.lineId === i.id ? " selected" : ""}>${esc(i.text.length > 110 ? i.text.slice(0, 108) + "…" : i.text)}</option>`).join("")}</select></div>` : ""}
      </div>
      ${r.type === "sg" && r.check ? `<p class="small mon-prompt">${esc((C.SG_CHECKS.find(c => c[0] === r.check) || [])[2] || "")}</p>` : ""}
      ${r.type !== "sg" ? `<div class="field"><label for="mo-fo-${id}">Focus</label><input id="mo-fo-${id}" ${f("focus")} value="${esc(r.focus || "")}" placeholder="e.g. Reading in Year 3: is phonics teaching consistent?"></div>` : ""}
      ${r.status === "done" ? `<p class="small" id="mo-hint-${id}">Write about what you saw across the school. Don't record pupils' or staff names.</p>
      <div class="two"><div class="field"><label for="mo-fd-${id}">What we found</label><textarea id="mo-fd-${id}" ${f("found")} rows="4" aria-describedby="mo-hint-${id}">${esc(r.found || "")}</textarea></div>
        <div class="field"><label for="mo-nx-${id}">What needs to happen next</label><textarea id="mo-nx-${id}" ${f("next")} rows="4" aria-describedby="mo-hint-${id}">${esc(r.next || "")}</textarea></div></div>
      <fieldset class="judge-pick"><legend>Overall</legend>${Object.entries(C.JUDGE).map(([k, l]) => `<label class="switch"><input type="radio" name="mj-${id}" value="${k}" data-mj="${id}"${r.judge === k ? " checked" : ""}> ${l}</label>`).join("")}</fieldset>` : ""}
      ${actions.length ? `<ul class="ag-acts">${actions.map(a => `<li>${I(a.status === "done" ? "circle-check" : "target", 16)}<span><b>${esc(a.title || "Action")}</b>${a.owner ? " · " + esc(a.owner) : ""}${a.due ? " · due " + esc(a.due) : ""}</span></li>`).join("")}</ul>` : ""}
      <div class="mon-foot">
        ${r.status === "planned" ? `<button class="btn primary" type="button" data-mdone="${id}">${I("circle-check", 16)}Record what we found</button>` : `
          <button class="btn" type="button" data-mact="${id}"${r.next ? "" : " disabled"}>${I("target", 16)}Turn next steps into an action</button>
          <button class="btn" type="button" data-mev="${id}"${r.lineId && (r.found || r.next) ? "" : " disabled"}>${I("file-text", 16)}${r.evidenceAt ? "Added to the line's evidence" : "Add to the line's evidence"}</button>`}
        <span class="spacer"></span><button class="btn" type="button" data-mdelete="${id}">${I("trash", 16)}Delete</button>
      </div>
    </div>`;
  }

  function create(rec, open) {
    const r = { id: uid(), type: "walk", check: "", date: today(), by: "", areaId: "", lineId: "", focus: "", found: "", next: "", judge: "", status: "done", actionIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...rec };
    list().push(r); if (open !== false) opened.add(r.id);
    H.save(); render();
    const first = document.querySelector(`[data-mid="${r.id}"] select, [data-mid="${r.id}"] input`);
    if (first) { first.focus(); first.scrollIntoView({ block: "center" }); }
    return r;
  }

  function onClick(e) {
    const b = e.target.closest("button"); if (!b) return false;
    const d = b.dataset, find = id => list().find(r => r.id === id);
    if (b.id === "monAdd") { create({ status: "done" }); return true; }
    if (b.id === "monPlan") { const dt = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10); create({ status: "planned", date: dt }); return true; }
    if (d.msg) { create({ type: "sg", check: d.msg, areaId: "sg", by: dslName(), focus: C.SG[d.msg] }); return true; }
    if (d.mopen) { opened.add(d.mopen); fArea = ""; fType = ""; render(); const c = document.querySelector(`[data-mid="${d.mopen}"]`); if (c) { c.scrollIntoView({ block: "center" }); c.querySelector("button").focus(); } return true; }
    if (d.mtoggle) { opened.has(d.mtoggle) ? opened.delete(d.mtoggle) : opened.add(d.mtoggle); render(); const t = document.querySelector(`[data-mtoggle="${d.mtoggle}"]`); if (t) t.focus(); return true; }
    if (d.mdone) { const r = find(d.mdone); r.status = "done"; if (!r.date || r.date > today()) r.date = today(); r.updatedAt = new Date().toISOString(); H.save(); render(); const t = el("mo-fd-" + r.id); if (t) t.focus(); return true; }
    if (d.mact) {
      const r = find(d.mact); if (!r || !r.next) return true;
      const first = String(r.next).split(/\n|\. /)[0].trim().slice(0, 140);
      const a = P.add({ title: first, owner: r.by || "", itemId: r.lineId || "", source: "monitoring", monitoringId: r.id, detail: `From monitoring on ${nice(r.date)}: ${C.title(r)}`, status: "todo" }, true);
      (r.actionIds = r.actionIds || []).push(a.id); r.updatedAt = new Date().toISOString();
      H.save(); render(); P.render(); H.toast("Added to the improvement plan. Add a due date there."); return true;
    }
    if (d.mev) {
      const r = find(d.mev); if (!r || !r.lineId) return true;
      const st = H.state(), add = `${nice(r.date)}, ${C.TYPE[r.type] || "monitoring"}${r.by ? " (" + r.by + ")" : ""}: ${[r.found, r.next ? "Next: " + r.next : ""].filter(Boolean).join(" ")}`.trim();
      st.notes = st.notes || {};
      st.notes[r.lineId] = (st.notes[r.lineId] ? st.notes[r.lineId].trim() + "\n\n" : "") + add;
      r.evidenceAt = new Date().toISOString();
      H.save(); render(); H.rerender && H.rerender(); H.toast("Added to the line's evidence in Evaluate"); return true;
    }
    if (d.mdelete) {
      const arr = list(), i = arr.findIndex(r => r.id === d.mdelete); if (i < 0) return true;
      const [gone] = arr.splice(i, 1); H.save(); render(); H.undo("Monitoring deleted", () => { arr.splice(i, 0, gone); H.save(); render(); });
      return true;
    }
    return false;
  }
  function onInput(e) {
    const t = e.target;
    if (!t.dataset.mf || t.tagName === "SELECT") return;
    const [id, k] = t.dataset.mf.split("|"); const r = list().find(x => x.id === id); if (!r) return;
    r[k] = t.value; r.updatedAt = new Date().toISOString(); H.save();
    if (k === "next") { const b = document.querySelector(`[data-mact="${id}"]`); if (b) b.disabled = !t.value.trim(); }
    if (k === "found" || k === "next") { const b = document.querySelector(`[data-mev="${id}"]`); if (b) b.disabled = !(r.lineId && (r.found || r.next)); }
  }
  function onChange(e) {
    const t = e.target;
    if (t.id === "monFA") { fArea = t.value; render(); el("monFA").focus(); return; }
    if (t.id === "monFT") { fType = t.value; render(); el("monFT").focus(); return; }
    if (t.dataset.mj) { const r = list().find(x => x.id === t.dataset.mj); if (r) { r.judge = t.value; r.updatedAt = new Date().toISOString(); H.save(); } return; }
    if (t.dataset.mf && (t.tagName === "SELECT" || t.type === "date")) {
      const [id, k] = t.dataset.mf.split("|"); const r = list().find(x => x.id === id); if (!r) return;
      r[k] = t.value; r.updatedAt = new Date().toISOString();
      if (k === "areaId") r.lineId = "";
      if (k === "type") {
        if (t.value === "sg") { r.areaId = "sg"; } else r.check = "";
        const SI = root.HWWD.siams;
        if (SI && SI.isChurch(H.state().profile || {}) && !r.iq) { if (t.value === "cw") r.iq = "iq3"; if (t.value === "re") r.iq = SI.hasIQ7(H.state().profile) ? "iq7" : "iq6"; }
        if (t.value === "re" && !r.areaId) r.areaId = "ct";
      }
      if (k === "check" && t.value) r.focus = C.SG[t.value];
      H.save(); render(); const again = el(t.id); if (again) again.focus();
    }
  }
  function init(host) {
    H = host; I = host.icon; esc = host.esc; P = host.plan; el = id => document.getElementById(id);
    document.addEventListener("click", e => { if (onClick(e)) e.stopPropagation(); }, true);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange);
  }
  function isEditing() { const a = document.activeElement; return !!(a && el("monView") && el("monView").contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); }
  root.HWWD.monitor = { init, render, isEditing };
})(window);
