/*
 * Evalu8 Compass — half-termly leadership meeting agendas (shared by browser and server)
 * ------------------------------------------------------------
 * buildAgenda(state, areas, today) looks at the improvement plan and the self-
 * evaluation and returns the items leaders most need to discuss, in order:
 * safeguarding first, then what's at risk, overdue, changed, and the gaps
 * without an owner, then impact of what's been done.
 * Each item: { id, kind, title, prompt, lines: [string], lineIds: [], actionIds: [] }
 */
(function (root) {
  const LABEL = { met: "Met", part: "Partly", no: "Not yet", na: "N/A" };
  const nice = ymd => ymd ? new Date(ymd + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "";
  const uid = () => Math.random().toString(36).slice(2, 10);
  const C = typeof module !== "undefined" && module.exports ? require("./checks.js") : root.HWWD.checks;

  function buildAgenda(state, areas, today) {
    const st = state || {}, t = today || new Date().toISOString().slice(0, 10);
    const answers = st.answers || {}, actions = (st.actions || []).filter(a => a && a.id);
    const lines = {};
    (areas || []).forEach(a => a.items.forEach(i => { lines[i.id] = { text: i.text, area: a.name, areaId: a.id }; }));
    const text = id => (lines[id] || {}).text || id;
    const open = actions.filter(a => a.status !== "done");
    const last = (st.meetings || []).filter(m => m.status === "done" && m.closedAt).sort((a, b) => b.closedAt.localeCompare(a.closedAt))[0] || null;
    const since = last ? last.closedAt.slice(0, 10) : null;
    const desc = a => `${a.title || "Untitled action"}${a.owner ? " (" + a.owner + ")" : ""}${a.due ? ", due " + nice(a.due) : ""}`;
    const items = [];
    const add = (kind, title, prompt, list, lineIds, actionIds) => { if (list.length) items.push({ id: uid(), kind, title, prompt, lines: list, lineIds: lineIds || [], actionIds: actionIds || [] }); };

    // 1. Safeguarding: always on the agenda
    const sgLines = Object.keys(lines).filter(k => k.startsWith("sg-") && (answers[k] === "no" || answers[k] === "part"));
    const sgActions = open.filter(a => String(a.itemId || "").startsWith("sg-"));
    const sgc = C.sgStatus(st, t);
    const sgList = [...sgLines.map(k => `${text(k)}: ${LABEL[answers[k]]}`), ...sgActions.map(a => `Action: ${desc(a)}${a.due && a.due < t ? " (overdue)" : ""}`),
      `DSL's termly checks (${sgc.term.name}): ${sgc.done} of ${sgc.total} done${sgc.done < sgc.total ? "; still to do: " + sgc.list.filter(x => !x.rec).map(x => x.label).join(", ") : ""}${sgc.concerns ? `; ${sgc.concerns} raised a concern` : ""}`];
    items.push({ id: uid(), kind: "safeguarding", title: "Safeguarding", prompt: "DSL update: is the culture of safeguarding working in practice? Concerns acted on promptly, records audited, filtering and monitoring checked, children missing education followed up.",
      lines: sgList, lineIds: sgLines, actionIds: sgActions.map(a => a.id) });

    // 2. At risk or off track
    const risk = open.filter(a => a.rag === "risk" || a.rag === "off");
    add("risk", "Actions at risk or off track", "What's getting in the way, and what will get each one back on track?", risk.map(a => `${a.rag === "off" ? "Off track" : "At risk"}: ${desc(a)}`), [], risk.map(a => a.id));

    // 3. Overdue actions and late milestones
    const late = open.filter(a => a.due && a.due < t && !risk.includes(a));
    const lateMs = open.flatMap(a => (a.milestones || []).filter(m => !m.done && m.due && m.due < t).map(m => ({ a, m })));
    add("overdue", "Overdue actions and milestones", "Agree a new date and who will make sure it happens, or close it if it's done.",
      [...late.map(a => `Overdue: ${desc(a)}`), ...lateMs.map(x => `Milestone late: ${x.m.text || "milestone"} (${x.a.title || "action"}), was due ${nice(x.m.due)}`)], [], [...new Set([...late, ...lateMs.map(x => x.a)].map(a => a.id))]);

    // 4. What has changed since the last meeting
    if (last && last.answersAtClose) {
      const before = last.answersAtClose, order = { no: 0, part: 1, met: 2 };
      const ch = Object.keys(lines).filter(k => order[answers[k]] != null && order[before[k]] != null && answers[k] !== before[k]);
      const up = ch.filter(k => order[answers[k]] > order[before[k]]), down = ch.filter(k => order[answers[k]] < order[before[k]]);
      add("changes", "What has changed since the last meeting", "Do we agree with these changes? What's the evidence?",
        [...down.map(k => `Slipped: ${text(k)} (${LABEL[before[k]]} → ${LABEL[answers[k]]})`), ...up.map(k => `Better: ${text(k)} (${LABEL[before[k]]} → ${LABEL[answers[k]]})`)], [...down, ...up]);
    }

    // 4b. What monitoring has shown (safeguarding checks are covered above)
    const mon = C.since(st, since || C.term(t).start).filter(r => r.type !== "sg");
    add("monitoring", "What our monitoring shows", "Do the findings match our self-evaluation? What should we follow up?",
      mon.slice(0, 12).map(r => C.line(r, true)), [...new Set(mon.map(r => r.lineId).filter(Boolean))].slice(0, 8));

    // 4c. Church schools: living up to our foundation (SIAMS)
    const SI = typeof module !== "undefined" && module.exports ? require("./siams.js") : root.HWWD.siams;
    if (SI && SI.isChurch(st.profile)) {
      const lines = SI.summaryLines(st);
      items.push({ id: uid(), kind: "siams", title: "Living our Christian vision (SIAMS)", prompt: "Is our theologically rooted Christian vision enabling pupils and adults to flourish? Which Inspection Questions can't we yet answer \"yes\", and what will change that?", lines, lineIds: [], actionIds: (st.actions || []).filter(a => a.siams && a.status !== "done").map(a => a.id) });
    }

    const CS = typeof module !== "undefined" && module.exports ? require("./csi.js") : root.HWWD.csi;
    if (CS && CS.isCatholic(st.profile)) {
      items.push({ id: uid(), kind: "csi", title: "Catholic life and mission, RE and worship", prompt: "Is our evaluation of Catholic life and mission, religious education and collective worship accurate? What will move each area on, and how will we know?", lines: CS.summaryLines(st), lineIds: [], actionIds: (st.actions || []).filter(a => a.csi && a.status !== "done").map(a => a.id) });
    }

    // 5. Areas needing attention, and gaps nobody owns
    const scored = (areas || []).map(a => {
      const rated = a.items.filter(i => answers[i.id] && answers[i.id] !== "na");
      const met = rated.filter(i => answers[i.id] === "met").length, part = rated.filter(i => answers[i.id] === "part").length;
      return { a, rated: rated.length, pct: rated.length ? Math.round((met + part * 0.5) / rated.length * 100) : null };
    }).filter(x => x.rated >= 3 && x.a.id !== "sg").sort((x, y) => x.pct - y.pct);
    const weak = scored.filter(x => x.pct < 70).slice(0, 2);
    add("areas", "Areas needing attention", "Are our priorities still the right ones? What will make the biggest difference next half-term?",
      weak.map(x => `${x.a.name}: ${x.pct}% of what's rated is in place`), [], []);
    const owned = new Set(actions.map(a => a.itemId).filter(Boolean));
    const unowned = Object.keys(lines).filter(k => answers[k] === "no" && !owned.has(k) && !k.startsWith("sg-"));
    add("gaps", "Not yet, and no action", "Should any of these become an action, with an owner and a date?", unowned.slice(0, 12).map(k => `${(lines[k] || {}).area}: ${text(k)}`), unowned.slice(0, 12));

    // 6. Impact of what's been done
    const done = actions.filter(a => a.status === "done" && (!since || !a.doneAt || a.doneAt.slice(0, 10) >= since));
    const doing = open.filter(a => a.status === "doing");
    add("impact", "Impact: what difference has our work made?", "For each, what do staff, pupils or an inspector now see? Record it as the action's impact.",
      [...done.slice(0, 10).map(a => `Done: ${a.title || "action"}${a.impact ? " · Impact so far: " + a.impact : " · Impact not yet recorded"}`), ...doing.slice(0, 10).map(a => `In progress: ${a.title || "action"}${a.impact ? " · " + a.impact : ""}`)], [], [...done, ...doing].slice(0, 20).map(a => a.id));

    items.push({ id: uid(), kind: "next", title: "Next steps and any other business", prompt: "Confirm owners and dates for new actions, and the date of the next meeting.", lines: [], lineIds: [], actionIds: [] });
    return items;
  }

  /** Suggested dates for this academic year's six half-termly meetings (near the end of each half-term). */
  function suggestedDates(today) {
    const t = today || new Date().toISOString().slice(0, 10);
    const y = Number(t.slice(0, 4)), start = t.slice(5) >= "09-01" ? y : y - 1;
    return [`${start}-10-15`, `${start}-12-08`, `${start + 1}-02-09`, `${start + 1}-03-23`, `${start + 1}-05-18`, `${start + 1}-07-06`].filter(d => d >= t);
  }

  const api = { buildAgenda, suggestedDates, LABEL };
  root.HWWD = Object.assign(root.HWWD || {}, { agenda: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
