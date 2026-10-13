/*
 * Evalu8 Compass — the Reports tab: a report for each of Ofsted's evaluation areas,
 * owned by its leader, with key figures, commentary and (for Curriculum and
 * teaching) subject leaders' reviews. Each can be printed or emailed.
 */
(function (root) {
  const BR = root.HWWD.briefs, L = root.HWWD.leaders;
  let H, I, esc, el, open = null;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const st = () => H.state();
  const leads = () => st().leads || (st().leads = {});
  const subjects = () => st().subjects || (st().subjects = []);

  /** A report or paper as HTML (also used for the SIP discussion paper). */
  function renderDoc(doc) {
    return `<div class="doc"><h3 class="doc-title">${esc(doc.title)}</h3>${doc.sections.map(s => `<section class="doc-sec"><h4>${esc(s.head)}</h4>
      ${s.para ? `<p class="doc-para">${esc(s.para)}</p>` : ""}
      ${(s.lines || []).length ? `<ul>${s.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
      ${s.table ? `<div class="doc-tbl"><table><thead><tr>${s.table.cols.map(c => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${s.table.rows.map(r => `<tr>${r.map((c, i) => i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
    </section>`).join("")}</div>`;
  }

  function render() {
    const box = el("leadList"); if (!box) return;
    const areas = H.view(), answers = st().answers || {}, team = st().team || [];
    if (open && !areas.some(a => a.id === open)) open = null;
    if (!open) {
      box.innerHTML = `<div class="lead-grid">${areas.map(a => {
        const sc = BR.score(a, answers), who = team.filter(m => (m.areas || []).includes(a.id));
        const acts = (st().actions || []).filter(x => x.itemId && a.items.some(i => i.id === x.itemId) && x.status !== "done");
        const risk = acts.filter(x => x.rag === "risk" || x.rag === "off").length;
        return `<article class="lead-card"><h3>${esc(a.name)}</h3>
          <p class="lead-meta">${sc.rated ? `<b>${sc.pct}%</b> in place · ${sc.no} Not yet` : "Not rated yet"} · ${acts.length} open action${acts.length === 1 ? "" : "s"}${risk ? ` · <span class="warn">${risk} at risk</span>` : ""}</p>
          <p class="lead-who">${who.length ? "Led by " + esc(who.map(m => m.name || L.SHORT[m.role]).join(", ")) : "No leader assigned"}</p>
          <button class="btn" type="button" data-lopen="${a.id}">${I("file-text", 16)}Open report</button></article>`;
      }).join("")}</div>`;
      return;
    }
    const a = areas.find(x => x.id === open), lead = leads()[open] || {}, ind = BR.INDICATORS[open] || [];
    const who = team.filter(m => (m.areas || []).includes(open));
    box.innerHTML = `<div class="lead-report">
      <div class="lead-bar"><button class="btn" type="button" data-lback="1">${I("arrow-right", 16, "flip")}All areas</button><span class="spacer"></span>
        <button class="btn" type="button" data-lprint="1">${I("file-export", 16)}Print or save as PDF</button>
        <button class="btn primary" type="button" data-lsend="${open}"${who.some(m => L.validEmail(m.email)) || team.some(m => m.role === "head" && L.validEmail(m.email)) ? "" : " disabled"}>${I("mail", 16)}Email to the leader and head</button></div>
      <h3>${esc(a.name)}</h3>
      <fieldset class="lead-who-edit"><legend>Led by</legend>${team.length ? team.filter(m => m.role !== "sip").map(m => `<label class="switch"><input type="checkbox" data-lwho="${m.id}"${(m.areas || []).includes(open) ? " checked" : ""}> ${esc(m.name || L.LABEL[m.role])} <span class="muted-inline">${esc(L.SHORT[m.role])}</span></label>`).join("") : `<span class="small">Add your team in the Team tab first.</span>`}</fieldset>
      ${ind.length ? `<fieldset class="lead-ind"><legend>Key figures <span class="muted-inline">(whole-school numbers only, never pupils' names)</span></legend>
        <div class="ind-grid"><span></span><span class="lbl">This term</span><span class="lbl">Last term</span>
        ${ind.map(([k, label, unit]) => { const v = (lead.indicators || {})[k] || {}; return `<label for="ind-${k}-now">${esc(label)}${unit && unit !== "text" ? ` (${unit})` : ""}</label>
          <input id="ind-${k}-now" data-lind="${k}|now" value="${esc(v.now || "")}" ${unit === "text" ? "" : 'inputmode="decimal"'}><input id="ind-${k}-last" data-lind="${k}|last" value="${esc(v.last || "")}" aria-label="${esc(label)}, last term" ${unit === "text" ? "" : 'inputmode="decimal"'}>`; }).join("")}</div></fieldset>` : ""}
      <div class="field"><label for="lc-${open}">Leader's commentary</label><p class="small" id="lch">Where are we, what are we doing about it, and what difference is it making?</p><textarea id="lc-${open}" data-lcom="${open}" rows="5" aria-describedby="lch">${esc(lead.commentary || "")}</textarea></div>
      ${open === "ct" ? subjectsHTML() : ""}
      <h4 class="lead-preview-h">The report</h4>
      <div class="lead-preview" id="leadPreview">${renderDoc(BR.areaReport(st(), areas, open))}</div>
    </div>`;
  }
  function subjectsHTML() {
    const list = subjects(), have = new Set(list.map(s => s.subject));
    const opts = BR.SUBJECTS.filter(s => !have.has(s));
    return `<section class="subjects" aria-labelledby="subTitle"><h4 id="subTitle">Subject reviews</h4>
      <p class="small">Each subject leader reviews their subject each term. The ratings and next steps feed this report.</p>
      ${list.map(s => `<article class="subj" data-sid="${s.id}" aria-label="${esc(s.subject)}">
        <div class="subj-top"><h5>${esc(s.subject)}</h5><label class="sr-only" for="sl-${s.id}">Subject leader</label><input id="sl-${s.id}" data-sfld="${s.id}|leader" value="${esc(s.leader || "")}" placeholder="Subject leader" list="ownerList" autocomplete="off"><button class="iconbtn" type="button" data-sdel="${s.id}" aria-label="Remove ${esc(s.subject)}">${I("x", 16)}</button></div>
        <div class="subj-grid">${BR.SUBJECT_PROMPTS.map(([k, label]) => `<label class="subj-q"><span>${esc(label)}</span><select data-srate="${s.id}|${k}"><option value="">Not rated</option>${["met", "part", "no"].map(v => `<option value="${v}"${(s.ratings || {})[k] === v ? " selected" : ""}>${BR.LABEL[v]}</option>`).join("")}</select></label>`).join("")}</div>
        <div class="two"><div class="field"><label for="ss-${s.id}">Strengths</label><textarea id="ss-${s.id}" data-sfld="${s.id}|strengths" rows="2">${esc(s.strengths || "")}</textarea></div>
        <div class="field"><label for="sn-${s.id}">Next steps</label><textarea id="sn-${s.id}" data-sfld="${s.id}|next" rows="2">${esc(s.next || "")}</textarea></div></div>
      </article>`).join("")}
      ${opts.length ? `<div class="subj-add"><label for="subjPick" class="sr-only">Add a subject</label><select id="subjPick"><option value="">Choose a subject…</option>${opts.map(s => `<option>${esc(s)}</option>`).join("")}</select><button class="btn" type="button" data-sadd="1">${I("book", 16)}Add subject review</button></div>` : ""}
    </section>`;
  }
  function refreshPreview() { const p = el("leadPreview"); if (p && open) p.innerHTML = renderDoc(BR.areaReport(st(), H.view(), open)); }

  function onClick(e) {
    const b = e.target.closest("button"); if (!b || !el("leadView") || !el("leadView").contains(b)) return false;
    const d = b.dataset;
    if (d.lopen) { open = d.lopen; render(); el("leadView").scrollIntoView({ block: "start" }); return true; }
    if (d.lback) { open = null; render(); return true; }
    if (d.lprint) { document.body.classList.add("print-doc"); el("leadPreview").classList.add("printing"); window.print(); setTimeout(() => { document.body.classList.remove("print-doc"); el("leadPreview").classList.remove("printing"); }, 500); return true; }
    if (d.lsend) { send(b, d.lsend); return true; }
    if (d.sadd) { const v = el("subjPick").value; if (!v) { el("subjPick").focus(); return true; } subjects().push({ id: uid(), subject: v, leader: "", ratings: {}, strengths: "", next: "", updatedAt: new Date().toISOString() }); H.save(); render(); return true; }
    if (d.sdel) { const list = subjects(), i = list.findIndex(s => s.id === d.sdel); if (i >= 0) { const [gone] = list.splice(i, 1); H.save(); render(); H.undo(`${gone.subject} removed`, () => { list.splice(i, 0, gone); H.save(); render(); }); } return true; }
    return false;
  }
  async function send(b, areaId) {
    b.disabled = true; await H.flush();
    try {
      const r = await fetch(`api/school/reports/${areaId}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const dd = await r.json(); H.toast(r.ok ? `Report emailed to ${dd.sent} ${dd.sent === 1 ? "person" : "people"}` : dd.error || "That didn't send.");
    } catch (e) { H.toast("Couldn't reach the server. Try again."); }
    b.disabled = false;
  }
  function onInput(e) {
    const t = e.target;
    if (t.dataset.lcom) { const l = leads()[t.dataset.lcom] || (leads()[t.dataset.lcom] = { commentary: "", indicators: {} }); l.commentary = t.value; l.updatedAt = new Date().toISOString(); H.save(); refreshPreview(); return; }
    if (t.dataset.lind) { const [k, which] = t.dataset.lind.split("|"); const l = leads()[open] || (leads()[open] = { commentary: "", indicators: {} }); l.indicators = l.indicators || {}; (l.indicators[k] = l.indicators[k] || { now: "", last: "" })[which] = t.value; l.updatedAt = new Date().toISOString(); H.save(); refreshPreview(); return; }
    if (t.dataset.sfld) { const [sid, f] = t.dataset.sfld.split("|"); const s = subjects().find(x => x.id === sid); if (s) { s[f] = t.value; s.updatedAt = new Date().toISOString(); H.save(); refreshPreview(); } return; }
  }
  function onChange(e) {
    const t = e.target;
    if (t.dataset.lwho) { const m = (st().team || []).find(x => x.id === t.dataset.lwho); if (m) { const s = new Set(m.areas || []); t.checked ? s.add(open) : s.delete(open); m.areas = [...s]; H.save(); refreshPreview(); } return; }
    if (t.dataset.srate) { const [sid, k] = t.dataset.srate.split("|"); const s = subjects().find(x => x.id === sid); if (s) { s.ratings = s.ratings || {}; if (t.value) s.ratings[k] = t.value; else delete s.ratings[k]; s.updatedAt = new Date().toISOString(); H.save(); refreshPreview(); } return; }
  }
  function init(host) {
    H = host; I = host.icon; esc = host.esc; el = id => document.getElementById(id);
    document.addEventListener("click", e => { if (onClick(e)) e.stopPropagation(); }, true);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange);
  }
  function isEditing() { const a = document.activeElement; return !!(a && el("leadView") && el("leadView").contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName)); }
  root.HWWD.leads = { init, render, renderDoc, isEditing };
})(window);
