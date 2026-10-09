/*
 * Collates staff responses into workshop findings.
 * Privacy rule: a role group's answers or comment labels are only shown when
 * at least MIN_GROUP_SIZE people in that role have answered the line.
 */
const C = require("../public/js/criteria.js");

const MIN_GROUP = Number(process.env.MIN_GROUP_SIZE || 3);
const ROLES = {
  teacher: "Teachers", ta: "Teaching assistants", support: "Support staff",
  slt: "Senior leaders", governor: "Governors / trustees", other: "Other",
};
const KEYS = ["met", "part", "no", "na"];

/** The areas and items in this workshop, resolved for the school's type and phases. */
function itemsFor(session) {
  return C.resolve(session.profile).filter(a => session.areaIds.includes(a.id));
}

function blank() { return { met: 0, part: 0, no: 0, na: 0, n: 0 }; }

function aggregate(session) {
  const areas = itemsFor(session);
  const pids = Object.keys(session.participants);
  const roleCounts = {};
  pids.forEach(p => { const r = session.participants[p].role; roleCounts[r] = (roleCounts[r] || 0) + 1; });

  let answered = 0, possible = 0;
  const out = areas.map(a => {
    const items = a.items.map(it => {
      const all = blank(), byRole = {}, comments = [];
      for (const pid of pids) {
        const r = session.responses[pid] && session.responses[pid][it.id];
        if (!r) continue;
        const role = session.participants[pid].role;
        if (r.c && r.c.trim()) comments.push({ role, text: r.c.trim().slice(0, 600) });
        if (!KEYS.includes(r.s)) continue;
        all[r.s]++; all.n++;
        (byRole[role] = byRole[role] || blank())[r.s]++; byRole[role].n++;
      }
      answered += all.n; possible += pids.length;

      // Hide small role groups
      const roles = {};
      for (const [role, c] of Object.entries(byRole)) if (c.n >= MIN_GROUP) roles[role] = c;
      const shownComments = comments
        .map(c => ({ text: c.text, role: byRole[c.role] && byRole[c.role].n >= MIN_GROUP ? ROLES[c.role] || "Other" : null }))
        .sort(() => Math.random() - 0.5);

      const rated = all.met + all.part + all.no;
      const top = rated ? Math.max(all.met, all.part, all.no) / rated : 0;
      const mode = rated ? ["met", "part", "no"].reduce((m, k) => (all[k] > all[m] ? k : m), "met") : null;
      const score = rated ? (all.met + all.part * 0.5) / rated : null;

      // Perception gap: leaders vs everyone else, only when both groups are big enough
      let gap = null;
      const lead = byRole.slt;
      if (lead && lead.n >= MIN_GROUP) {
        const rest = blank();
        for (const [role, c] of Object.entries(byRole)) if (role !== "slt") KEYS.forEach(k => { rest[k] += c[k]; rest.n += c[k]; });
        const sc = c => { const r = c.met + c.part + c.no; return r ? (c.met + c.part * 0.5) / r : null; };
        const a1 = sc(lead), a2 = sc(rest);
        if (rest.n >= MIN_GROUP && a1 != null && a2 != null && Math.abs(a1 - a2) >= 0.3) gap = { leaders: Math.round(a1 * 100), others: Math.round(a2 * 100) };
      }

      return {
        id: it.id, text: it.text, evidence: it.evidence, ref: it.ref,
        counts: all, roles, comments: shownComments, mode,
        score: score == null ? null : Math.round(score * 100),
        split: rated >= 3 && top < 0.6, gap,
        agreed: session.agreed[it.id] || null,
      };
    });
    const rated = items.reduce((s, i) => s + i.counts.met + i.counts.part + i.counts.no, 0);
    const pts = items.reduce((s, i) => s + i.counts.met + i.counts.part * 0.5, 0);
    return { id: a.id, icon: a.icon, name: a.name, sub: a.sub, judged: !!a.judged, items, score: rated ? Math.round(pts / rated * 100) : null };
  });

  return {
    code: session.code,
    participants: pids.length,
    roleCounts: Object.fromEntries(Object.entries(roleCounts).map(([r, n]) => [r, n >= MIN_GROUP ? n : "fewer than " + MIN_GROUP])),
    completion: possible ? Math.round(answered / possible * 100) : 0,
    minGroup: MIN_GROUP,
    areas: out,
  };
}

module.exports = { aggregate, itemsFor, ROLES, MIN_GROUP };
