/* Evalu8 Compass — the governors' and trustees' read-only view */
(function () {
  const I = window.HWWD.icon, $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nice = d => d ? new Date(String(d).slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
  let data = null, openReport = null;

  function renderDoc(doc) {
    return `<div class="doc"><h3 class="doc-title">${esc(doc.title)}</h3>${doc.sections.map(s => `<section class="doc-sec"><h4>${esc(s.head)}</h4>
      ${s.para ? `<p class="doc-para">${esc(s.para)}</p>` : ""}
      ${(s.lines || []).length ? `<ul>${s.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
      ${s.table ? `<div class="doc-tbl"><table><thead><tr>${s.table.cols.map(c => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${s.table.rows.map(r => `<tr>${r.map((c, i) => i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
    </section>`).join("")}</div>`;
  }
  function toast(t) { const el = $("toast"); el.textContent = t; el.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("on"), 3500); }

  function render() {
    $("schoolName").textContent = data.school;
    document.title = `Governors and trustees · ${data.school}`;
    $("leaderLink").hidden = !data.leader; $("leaderNote").hidden = !data.leader;
    // Reports
    const reps = data.reports;
    if (openReport && !reps.some(r => r.id === openReport)) openReport = null;
    $("gReportList").innerHTML = reps.length ? reps.map((r, i) => {
      const open = openReport ? openReport === r.id : i === 0;
      return `<article class="gov-rep">
        <button class="mon-sum" type="button" data-grep="${r.id}" aria-expanded="${open}"><span class="mon-date">Issued ${esc(nice(r.issuedAt))}</span><span class="mon-title"><b>${esc(r.doc.title)}</b></span>${I("chevron-down", 18, open ? "flip-v" : "")}</button>
        ${open ? `<div class="mon-body"><div class="lead-preview" id="rep-${r.id}">${renderDoc(r.doc)}</div><div class="row"><button class="btn" type="button" data-gprint="${r.id}">${I("file-export", 16)}Print or save as PDF</button><button class="btn" type="button" data-gask="1">${I("message-circle", 16)}Ask a question about this report</button></div></div>` : ""}
      </article>`;
    }).join("") : `<div class="plan-empty"><span class="tile">${I("file-text", 26)}</span><h3>No termly report yet</h3><p>When the headteacher issues a termly report it appears here, and you'll get it by email. In the meantime, see <b>The school today</b>.</p></div>`;
    // Today
    $("gTodayDoc").innerHTML = renderDoc(data.today);
    // Questions
    const sel = $("askArea"), keep = sel.value;
    sel.innerHTML = `<option value="">Any area</option>` + data.areas.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join(""); sel.value = keep;
    const open = data.challenges.filter(c => c.status === "open").length;
    $("gOpenCount").textContent = open ? ` (${open} open)` : "";
    const area = id => (data.areas.find(a => a.id === id) || {}).name || "";
    $("gChallenges").innerHTML = `<h2 class="mon-h">Questions asked</h2>` + (data.challenges.length ? data.challenges.map(c => `<article class="chal ${c.status}">
      <div class="chal-top"><span class="chip-st st-${c.status}">${{ open: "Waiting for an answer", answered: "Answered", closed: "Closed" }[c.status]}</span><span class="small">${esc(c.by || "")}${c.asked ? " · " + esc(nice(c.asked)) : ""}${c.areaId ? " · " + esc(area(c.areaId)) : ""}</span></div>
      <p class="chal-q">${esc(c.question)}</p>
      ${c.response ? `<div class="chal-a"><b>Leaders' answer${c.respondedAt ? " (" + esc(nice(c.respondedAt)) + ")" : ""}:</b> ${esc(c.response)}</div>` : ""}
    </article>`).join("") : `<p class="small">No questions yet.</p>`);
  }

  function show(id) {
    ["gReports", "gToday", "gAsk"].forEach(v => $(v).classList.toggle("hide", v !== id));
    document.querySelectorAll("[data-gview]").forEach(b => { const on = b.dataset.gview === id; b.setAttribute("aria-selected", on); b.tabIndex = on ? 0 : -1; });
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.gview) return show(b.dataset.gview);
    if (b.dataset.grep) { openReport = b.getAttribute("aria-expanded") === "true" ? "-" : b.dataset.grep; render(); const t = document.querySelector(`[data-grep="${b.dataset.grep}"]`); if (t) t.focus(); return; }
    if (b.dataset.gprint) { const p = $("rep-" + b.dataset.gprint); document.body.classList.add("print-doc"); p.classList.add("printing"); window.print(); setTimeout(() => { document.body.classList.remove("print-doc"); p.classList.remove("printing"); }, 500); return; }
    if (b.dataset.gask) { show("gAsk"); $("askQ").focus(); }
  });
  document.querySelector('[role="tablist"]').addEventListener("keydown", e => {
    const tabs = [...document.querySelectorAll("[data-gview]")], i = tabs.indexOf(document.activeElement);
    if (i < 0 || !["ArrowRight", "ArrowLeft"].includes(e.key)) return;
    const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; n.focus(); show(n.dataset.gview); e.preventDefault();
  });
  try { $("askBy").value = localStorage.getItem("govName") || ""; } catch (e) {}
  $("askForm").addEventListener("submit", async e => {
    e.preventDefault(); $("askErr").textContent = "";
    const by = $("askBy").value.trim(), question = $("askQ").value.trim();
    if (!by) { $("askErr").textContent = "Add your name."; $("askBy").focus(); return; }
    if (question.length < 5) { $("askErr").textContent = "Write your question first."; $("askQ").focus(); return; }
    $("askGo").disabled = true;
    try {
      const r = await fetch("api/gov/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ by, question, areaId: $("askArea").value }) });
      const d = await r.json();
      if (!r.ok) { $("askErr").textContent = d.error || "That didn't send."; }
      else { try { localStorage.setItem("govName", by); } catch (e) {} $("askQ").value = ""; toast("Question sent. Leaders have been told."); await load(); }
    } catch (e) { $("askErr").textContent = "Couldn't reach the server. Try again."; }
    $("askGo").disabled = false;
  });
  $("signOut").addEventListener("click", e => { e.preventDefault(); fetch("api/access/logout", { method: "POST" }).finally(() => { location.href = "enter.html"; }); });

  async function load() {
    try {
      const r = await fetch("api/gov/view");
      if (r.status === 401) { location.href = "enter.html?next=%2Fgovernors.html"; return; }
      data = await r.json(); if (!r.ok) throw new Error(data.error);
      $("loadErr").textContent = ""; render();
    } catch (e) { $("loadErr").textContent = "Couldn't load the governors' view. Refresh to try again."; }
  }
  load();
})();
