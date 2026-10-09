/*
 * Evalu8 Compass — progress between two points in time
 * Compares a termly snapshot with now (or with another snapshot): what moved
 * from Not yet to Met, what slipped, area by area, and which actions were done.
 * Used by the checklist's Progress tab and by the report.
 */
(function (root) {
  const RANK = { no: 0, part: 1, met: 2 };
  const LABEL = { met: "Met", part: "Partly", no: "Not yet", na: "N/A", "": "Not assessed" };

  function tally(items, answers) {
    const c = { met: 0, part: 0, no: 0, na: 0, todo: 0, total: items.length };
    items.forEach(i => c[answers[i.id] || "todo"]++);
    const applicable = c.total - c.na;
    c.pct = applicable ? Math.round(c.met / applicable * 100) : 0;
    c.assessed = c.total - c.todo;
    return c;
  }

  /** view: areas from criteria.resolve(profile); from/to: saved checklist states */
  function compare(view, from, to) {
    const fa = (from && from.answers) || {}, ta = (to && to.answers) || {};
    const all = view.flatMap(a => a.items);
    const out = { from: tally(all, fa), to: tally(all, ta), areas: [], improved: [], slipped: [], newly: [], actionsDone: [], actionsAdded: 0 };
    view.forEach(a => {
      const f = tally(a.items, fa), t = tally(a.items, ta);
      out.areas.push({ id: a.id, name: a.name, from: f, to: t, change: t.pct - f.pct });
      a.items.forEach(i => {
        const x = fa[i.id] || "", y = ta[i.id] || "";
        if (x === y) return;
        const row = { area: a.name, id: i.id, text: i.text, from: x, to: y, fromLabel: LABEL[x], toLabel: LABEL[y] };
        if (x in RANK && y in RANK) (RANK[y] > RANK[x] ? out.improved : out.slipped).push(row);
        else if (!x && y) out.newly.push(row);
      });
    });
    const before = new Map(((from && from.actions) || []).map(a => [a.id, a]));
    ((to && to.actions) || []).forEach(a => {
      const b = before.get(a.id);
      if (!b) out.actionsAdded++;
      if (a.status === "done" && (!b || b.status !== "done")) out.actionsDone.push(a);
    });
    return out;
  }

  /** Suggested name for a snapshot taken today, e.g. "Autumn 2026". */
  function termName(d) {
    d = d ? new Date(d) : new Date();
    const m = d.getMonth(), y = d.getFullYear();
    return (m >= 8 ? "Autumn" : m <= 2 ? "Spring" : "Summer") + " " + y;
  }

  const api = { compare, termName, tally, LABEL };
  root.HWWD = Object.assign(root.HWWD || {}, { progress: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
