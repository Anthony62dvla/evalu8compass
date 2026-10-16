/*
 * Evalu8 Compass — the Meetings tab: half-termly leadership meetings
 * Meeting: { id, title, date, time, attendees: [team ids], status: "planned" | "live" | "done",
 *            agenda: [item], minutes: { itemId: notes }, actionIds: [], answersAtClose, closedAt,
 *            kind?: "sip" (a SIP or consultant visit, with focus and a discussion paper) }
 */
(function (root) {
  const A = root.HWWD.agenda, L = root.HWWD.leaders, BR = root.HWWD.briefs;
  let H, I, esc, el, P;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const meetings = () => H.state().meetings || (H.state().meetings = []);
  const today = () => new Date().toISOString().slice(0, 10);
  const nice = d => d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "No date yet";
  const RATE = { met: "Met", part: "Partly", no: "Not yet" };
  let showPast = false;

  function termTitle(d) {
    const dt = d || today(), m = Number(dt.slice(5, 7)), day = Number(dt.slice(8, 10));
    const name = m >= 9 && m <= 10 ? "Autumn first half-term" : m >= 11 ? "Autumn second half-term" : m <= 2 ? "Spring first half-term"
      : m === 3 || (m === 4 && day < 15) ? "Spring second half-term" : m <= 5 ? "Summer first half-term" : "Summer second half-term";
    return `Leadership meeting: ${name}`;
  }
  const paper = m => BR.sipPaper(H.state(), H.view(), { focus: m.focus, visit: m.title });
  const hasSip = m => (H.state().team || []).some(t => t.role === "sip" && (m.attendees || []).includes(t.id) && L.validEmail(t.email));

  function render() {
    const box = el("meetList"); if (!box) return;
    const all = meetings().slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const upcoming = all.filter(m => m.status !== "done"), past = all.filter(m => m.status === "done").reverse();
    el("meetTabCount").textContent = upcoming.length ? ` (${upcoming.length})` : "";
    el("meetPlanYear").hidden = upcoming.length > 0;
    box.innerHTML = (upcoming.length ? upcoming.map(card).join("") : `<div class="plan-empty"><span class="tile">${I("calendar-check", 26)}</span><h3>Schedule your half-termly leadership meetings</h3><p>Evalu8 Compass writes each agenda from your plan and self-evaluation, emails it to attendees a week before, and turns the decisions into actions in your improvement plan.</p></div>`)
      + (past.length ? `<details class="past"${showPast ? " open" : ""}><summary>Past meetings (${past.length})</summary>${past.map(card).join("")}</details>` : "");
    const d = box.querySelector("details.past"); if (d) d.addEventListener("toggle", () => { showPast = d.open; });
  }

  function attendeesHTML(m) {
    const team = H.state().team || [];
    if (!team.length) return `<p class="small">Add your leadership team in the Team tab to choose attendees.</p>`;
    return `<fieldset class="att"><legend>Attendees</legend><div class="att-list">${team.map(t => `<label class="switch"><input type="checkbox" data-matt="${m.id}|${t.id}"${(m.attendees || []).includes(t.id) ? " checked" : ""}${m.status === "done" ? " disabled" : ""}> ${esc(t.name || L.LABEL[t.role])} <span class="muted-inline">${esc(L.SHORT[t.role])}</span></label>`).join("")}</div></fieldset>`;
  }
  function actionsFor(m, itemId) {
    const ids = new Set((m.actions || []).filter(x => x.item === itemId).map(x => x.id));
    return (H.state().actions || []).filter(a => ids.has(a.id));
  }
  function itemHTML(m, it, i) {
    const live = m.status === "live", done = m.status === "done";
    const st = H.state(), notes = (m.minutes || {})[it.id] || "";
    const acts = actionsFor(m, it.id);
    return `<li class="ag-item ag-${esc(it.kind)}">
      <div class="ag-head"><span class="ag-n">${i + 1}</span><h4>${esc(it.title)}</h4>${!live && !done ? `<button class="iconbtn" type="button" data-agdel="${m.id}|${it.id}" aria-label="Remove ${esc(it.title)} from the agenda">${I("x", 16)}</button>` : ""}</div>
      ${it.prompt ? `<p class="ag-prompt">${esc(it.prompt)}</p>` : ""}
      ${it.lines.length ? `<ul class="ag-lines">${it.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
      ${live && it.lineIds && it.lineIds.length ? `<div class="ag-rate"><span class="lbl">Agree ratings</span>${it.lineIds.slice(0, 8).map(id => `<label class="ag-rl"><span>${esc(lineText(id))}</span><select data-agrate="${id}" aria-label="Rating">${["", "met", "part", "no"].map(v => `<option value="${v}"${(st.answers || {})[id] === v || (!v && !(st.answers || {})[id]) ? " selected" : ""}>${v ? RATE[v] : "Not rated"}</option>`).join("")}</select></label>`).join("")}</div>` : ""}
      ${live ? `<div class="field"><label for="mn-${it.id}">Discussion and decisions</label><textarea id="mn-${it.id}" data-mnote="${m.id}|${it.id}" rows="3" placeholder="What was agreed? Don't record pupils' names.">${esc(notes)}</textarea></div>`
        : done && notes ? `<p class="ag-minutes"><b>Decided:</b> ${esc(notes)}</p>` : ""}
      ${acts.length ? `<ul class="ag-acts">${acts.map(a => `<li>${I(a.status === "done" ? "circle-check" : "target", 16)}<span><b>${esc(a.title || "Action")}</b>${a.owner ? " · " + esc(a.owner) : ""}${a.due ? " · due " + esc(a.due) : ""}${a.status === "done" ? " · done" : ""}</span></li>`).join("")}</ul>` : ""}
      ${live ? `<div class="ag-add"><span class="lbl">New action</span>
        <input type="text" id="na-t-${it.id}" placeholder="What will we do?" aria-label="New action">
        <input type="text" id="na-o-${it.id}" placeholder="Owner" list="ownerList" aria-label="Owner" autocomplete="off">
        <input type="date" id="na-d-${it.id}" aria-label="Due date">
        <button class="btn" type="button" data-agact="${m.id}|${it.id}">${I("target", 16)}Add to the plan</button></div>` : ""}
    </li>`;
  }
  let lineMap = null;
  function lineText(id) {
    if (!lineMap) { lineMap = {}; H.view().forEach(a => a.items.forEach(i => { lineMap[i.id] = i.text; })); }
    return lineMap[id] || id;
  }
  function card(m) {
    const live = m.status === "live", done = m.status === "done", team = H.state().team || [];
    const att = team.filter(t => (m.attendees || []).includes(t.id));
    return `<article class="meeting${live ? " live" : ""}${done ? " done" : ""}" data-meet="${m.id}" aria-label="${esc(m.title)}">
      <div class="meet-top">
        ${done ? `<h3>${esc(m.title)}</h3>` : `<label class="sr-only" for="mt-t-${m.id}">Meeting title</label><input class="meet-title" id="mt-t-${m.id}" data-mfld="${m.id}|title" value="${esc(m.title)}">`}
        <span class="meet-state">${live ? I("broadcast", 16) + "In the meeting" : done ? I("circle-check", 16) + "Done" : I("calendar-check", 16) + "Planned"}</span>
      </div>
      ${m.kind === "sip" ? `<p class="meet-kind">${I("users", 16)}SIP or consultant visit</p>` : ""}
      ${done ? `<p class="meet-when">${esc(nice(m.date))}${m.time ? " at " + esc(m.time) : ""} · ${att.length ? esc(att.map(t => t.name || L.SHORT[t.role]).join(", ")) : "No attendees recorded"}</p>`
        : `<div class="meet-grid"><div class="field"><label for="mt-d-${m.id}">Date</label><input type="date" id="mt-d-${m.id}" data-mfld="${m.id}|date" value="${esc(m.date)}"></div>
          <div class="field"><label for="mt-h-${m.id}">Time</label><input type="time" id="mt-h-${m.id}" data-mfld="${m.id}|time" value="${esc(m.time || "")}"></div></div>
          ${attendeesHTML(m)}`}
      ${m.kind === "sip" ? paperHTML(m, done) : ""}
      <div class="agenda">
        <div class="ag-bar"><h4>${done ? "Minutes" : "Agenda"}</h4>
          ${!done && !live ? `<button class="btn" type="button" data-agbuild="${m.id}">${I("refresh", 16)}${(m.agenda || []).length ? "Refresh from the plan" : "Write the agenda"}</button>` : ""}
        </div>
        ${(m.agenda || []).length ? `<ol class="ag-list">${m.agenda.map((it, i) => itemHTML(m, it, i)).join("")}</ol>`
          : `<p class="small">${done ? "No agenda was recorded." : "The agenda is written from your plan and self-evaluation: safeguarding first, then actions at risk or overdue, what has changed, areas needing attention and the impact of your work. It's emailed to attendees a week before the meeting."}</p>`}
        ${!done && !live ? `<div class="ag-own"><label class="sr-only" for="ag-new-${m.id}">Add your own agenda item</label><input type="text" id="ag-new-${m.id}" placeholder="Add your own item, e.g. Feedback from the trust review"><button class="btn" type="button" data-agown="${m.id}">${I("list-check", 16)}Add item</button></div>` : ""}
      </div>
      <div class="meet-foot">
        ${!done && !live && m.kind === "sip" ? `<button class="btn" type="button" data-msend="${m.id}|paper"${hasSip(m) ? "" : " disabled"}>${I("mail", 16)}Email the discussion paper</button>` : ""}
        ${!done && !live ? `<button class="btn" type="button" data-msend="${m.id}|agenda"${(m.agenda || []).length && att.some(t => L.validEmail(t.email)) ? "" : " disabled"}>${I("mail", 16)}Email the agenda now</button>
          <button class="btn primary" type="button" data-mstart="${m.id}"${(m.agenda || []).length ? "" : " disabled"}>${I("player-play", 16)}Start the meeting</button>
          <span class="spacer"></span><button class="btn" type="button" data-mdel2="${m.id}">${I("trash", 16)}Delete</button>` : ""}
        ${live ? `<button class="btn primary" type="button" data-mfinish="${m.id}">${I("circle-check", 16)}Finish and send the minutes</button>` : ""}
        ${done ? `<button class="btn" type="button" data-msend="${m.id}|minutes"${att.some(t => L.validEmail(t.email)) ? "" : " disabled"}>${I("mail", 16)}Email the minutes again</button>` : ""}
      </div>
    </article>`;
  }

  function paperHTML(m, done) {
    const team = H.state().team || [], sip = team.filter(t => t.role === "sip");
    return `<section class="paper" aria-label="Discussion paper">
      ${done ? (m.focus ? `<p class="ag-minutes"><b>Focus:</b> ${esc(m.focus)}</p>` : "") : `<div class="field"><label for="mt-f-${m.id}">What we'd like from this visit</label><textarea id="mt-f-${m.id}" data-mfld="${m.id}|focus" rows="3" placeholder="e.g. Test our view of reading in key stage 2; look at how well subject leaders check the impact of their work">${esc(m.focus || "")}</textarea></div>`}
      ${!done ? `<p class="small">${sip.length ? (hasSip(m) ? `The paper goes to everyone ticked above, including ${esc(sip.filter(t => (m.attendees || []).includes(t.id)).map(t => t.name || "your adviser").join(", "))}. A week before the visit, a draft is emailed to your leaders (not the adviser) to check.` : "Tick your SIP or consultant as an attendee to send them the paper. They need an email address in the Team tab.") : "Add your SIP or consultant in the Team tab (role: School improvement partner, diocesan adviser or consultant) to send them the paper."}</p>` : ""}
      <details class="paper-doc"><summary>${I("file-text", 16)}Read the discussion paper</summary><div class="lead-preview" id="pp-${m.id}">${H.renderDoc(paper(m))}</div>
        <button class="btn" type="button" data-pprint="${m.id}">${I("file-export", 16)}Print or save as PDF</button></details>
    </section>`;
  }

  async function send(id, kind, quiet) {
    await H.flush();
    try {
      const r = await fetch(`api/school/meetings/${id}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) });
      const d = await r.json();
      if (!quiet || !r.ok) H.toast(r.ok ? `${{ agenda: "Agenda", minutes: "Minutes", paper: "Discussion paper" }[kind]} emailed to ${d.sent} ${d.sent === 1 ? "person" : "people"}` : d.error || "That didn't send.");
      return r.ok;
    } catch (e) { H.toast("Couldn't reach the server. Try again."); return false; }
  }

  function onClick(e) {
    const b = e.target.closest("button"); if (!b) return false;
    const d = b.dataset, find = id => meetings().find(m => m.id === id);
    if (b.id === "meetSip") {
      const team = H.state().team || [], dt = A.suggestedDates(today())[0] || "";
      const m = { id: uid(), kind: "sip", title: termTitle(dt).replace("Leadership meeting", "SIP visit"), date: dt, time: "09:00", status: "planned", focus: "",
        attendees: team.filter(t => ["head", "deputy", "sip"].includes(t.role)).map(t => t.id), agenda: [], minutes: {}, actions: [], createdAt: new Date().toISOString() };
      m.agenda = BR.sipAgenda(paper(m));
      meetings().push(m); H.save(); render();
      H.toast(team.some(t => t.role === "sip") ? "Visit scheduled. Add what you'd like from it, then email the paper." : "Visit scheduled. Add your SIP or consultant in the Team tab to send them the paper.");
      const f = el("mt-f-" + m.id); if (f) f.focus();
      return true;
    }
    if (d.pprint) { const p = el("pp-" + d.pprint); document.body.classList.add("print-doc"); p.classList.add("printing"); window.print(); setTimeout(() => { document.body.classList.remove("print-doc"); p.classList.remove("printing"); }, 500); return true; }
    if (b.id === "meetAdd" || b.id === "meetPlanYear") {
      const team = H.state().team || [];
      const dates = b.id === "meetPlanYear" ? A.suggestedDates(today()) : [A.suggestedDates(today())[0] || ""];
      const made = dates.map(dt => ({ id: uid(), title: termTitle(dt), date: dt, time: "16:00", status: "planned", attendees: team.filter(t => ["head", "deputy", "dsl", "ahead", "senco"].includes(t.role)).map(t => t.id), agenda: [], minutes: {}, actions: [], createdAt: new Date().toISOString() }));
      meetings().push(...made); H.save(); render();
      H.toast(made.length > 1 ? `${made.length} meetings scheduled. Check the dates suit your term dates.` : "Meeting scheduled");
      return true;
    }
    if (d.agbuild) {
      const m = find(d.agbuild);
      if ((m.agenda || []).length && !confirm("Rewrite the agenda from the latest plan? Items you added yourself will be kept.")) return true;
      const own = (m.agenda || []).filter(x => x.kind === "own");
      const items = m.kind === "sip" ? BR.sipAgenda(paper(m)) : A.buildAgenda(H.state(), H.view(), today());
      m.agenda = [...items.slice(0, -1), ...own, items[items.length - 1]];
      H.save(); render(); H.toast("Agenda written from your plan"); return true;
    }
    if (d.agown) {
      const m = find(d.agown), inp = el("ag-new-" + m.id), title = inp.value.trim();
      if (!title) { inp.focus(); return true; }
      const item = { id: uid(), kind: "own", title, prompt: "", lines: [], lineIds: [], actionIds: [] };
      const ag = m.agenda || (m.agenda = []);
      const nextIdx = ag.findIndex(x => x.kind === "next");
      if (nextIdx >= 0) ag.splice(nextIdx, 0, item); else ag.push(item);
      H.save(); render(); el("ag-new-" + m.id).focus(); return true;
    }
    if (d.agdel) { const [mid, iid] = d.agdel.split("|"); const m = find(mid); m.agenda = m.agenda.filter(x => x.id !== iid); H.save(); render(); return true; }
    if (d.mstart) { const m = find(d.mstart); m.status = "live"; m.startedAt = new Date().toISOString(); H.save(); render(); const f = document.querySelector(`[data-meet="${m.id}"] textarea`); if (f) f.focus(); return true; }
    if (d.agact) {
      const [mid, iid] = d.agact.split("|"); const m = find(mid), it = m.agenda.find(x => x.id === iid);
      const title = el("na-t-" + iid).value.trim();
      if (!title) { H.toast("Say what the action is first."); el("na-t-" + iid).focus(); return true; }
      const a = P.add({ title, owner: el("na-o-" + iid).value.trim(), due: el("na-d-" + iid).value, source: "meeting", meetingId: m.id, itemId: it.lineIds && it.lineIds.length === 1 ? it.lineIds[0] : "", status: "todo" }, true);
      (m.actions = m.actions || []).push({ id: a.id, item: iid });
      H.save(); render(); P.render(); H.toast("Added to the improvement plan");
      const f = el("na-t-" + iid); if (f) f.focus();
      return true;
    }
    if (d.mfinish) {
      const m = find(d.mfinish);
      if (!confirm("Finish the meeting? The minutes and new actions are emailed to attendees, and a snapshot of your self-evaluation is saved.")) return true;
      m.status = "done"; m.closedAt = new Date().toISOString(); m.answersAtClose = { ...(H.state().answers || {}) };
      H.save(); render();
      send(m.id, "minutes", true).then(okSent => { if (okSent) H.toast("Meeting finished. Minutes emailed."); });
      H.snapshot && H.snapshot(m.title).catch(() => {});
      return true;
    }
    if (d.msend) { const [mid, kind] = d.msend.split("|"); b.disabled = true; send(mid, kind).finally(() => { b.disabled = false; }); return true; }
    if (d.mdel2) {
      const list = meetings(), i = list.findIndex(m => m.id === d.mdel2); if (i < 0) return true;
      const [gone] = list.splice(i, 1); H.save(); render(); H.undo("Meeting deleted", () => { list.splice(i, 0, gone); H.save(); render(); });
      return true;
    }
    return false;
  }
  function onInput(e) {
    const t = e.target;
    if (t.dataset.mfld) { const [mid, f] = t.dataset.mfld.split("|"); const m = meetings().find(x => x.id === mid); if (m) { m[f] = t.value; H.save(); const pp = el("pp-" + mid); if (pp && m.kind === "sip") pp.innerHTML = H.renderDoc(paper(m));
      if (f === "focus") { const it = (m.agenda || []).find(x => x.kind === "sip" && x.title === "The focus of this visit"); if (it) { it.prompt = t.value.trim() || "What do we want from today, and what does the adviser want to see?"; H.save(); } } } return; }
    if (t.dataset.mnote) { const [mid, iid] = t.dataset.mnote.split("|"); const m = meetings().find(x => x.id === mid); if (m) { (m.minutes = m.minutes || {})[iid] = t.value; H.save(); } return; }
  }
  function onChange(e) {
    const t = e.target;
    if (t.dataset.matt) {
      const [mid, tid] = t.dataset.matt.split("|"); const m = meetings().find(x => x.id === mid); if (!m) return;
      const s = new Set(m.attendees || []); t.checked ? s.add(tid) : s.delete(tid); m.attendees = [...s]; H.save(); render(); return;
    }
    if (t.dataset.agrate) { const st = H.state(); if (t.value) st.answers[t.dataset.agrate] = t.value; else delete st.answers[t.dataset.agrate]; H.save(); H.rerender && H.rerender(); return; }
    if (t.dataset.mfld && t.type === "date") { onInput(e); render(); }
  }
  function init(host) {
    H = host; I = host.icon; esc = host.esc; P = host.plan; el = id => document.getElementById(id);
    document.addEventListener("click", e => { if (onClick(e)) e.stopPropagation(); }, true);
    document.addEventListener("input", onInput);
    document.addEventListener("change", onChange);
    render();
  }
  function reset() { lineMap = null; }
  root.HWWD.meetings = { init, render, reset };
})(window);
