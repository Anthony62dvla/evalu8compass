/*
 * Evalu8 Compass — the leadership team (shared by browser and server)
 * ------------------------------------------------------------
 * Each school lists its key leaders: name, role and email. Actions are owned by
 * them (the action's Owner can be a name or a role, e.g. "DSL"), and alerts go
 * to them. The headteacher, deputy and DSL get the immediate alerts.
 */
(function (root) {
  const ROLES = [
    ["head", "Headteacher or principal", "Head"], ["deputy", "Deputy headteacher", "Deputy head"], ["dsl", "Designated safeguarding lead", "DSL"],
    ["ddsl", "Deputy DSL", "Deputy DSL"], ["senco", "SENCo", "SENCo"], ["ahead", "Assistant headteacher", "Assistant head"],
    ["phase", "Phase or key stage leader", "Phase leader"], ["subject", "Subject leader", "Subject leader"], ["attendance", "Attendance lead", "Attendance lead"],
    ["ey", "Early years lead", "EYFS lead"], ["p16", "Sixth form lead", "Sixth form lead"], ["gov", "Governor", "Governor"], ["trustee", "Trustee", "Trustee"], ["other", "Other", "Other"],
  ];
  const LABEL = Object.fromEntries(ROLES.map(r => [r[0], r[1]]));
  const SHORT = Object.fromEntries(ROLES.map(r => [r[0], r[2]]));
  const KEY = ["head", "deputy", "dsl"];          // get immediate alerts
  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const validEmail = e => /^[^@\s<>"(),;:]+@[^@\s<>"(),;:]+\.[a-z]{2,}$/i.test(String(e || "").trim());

  /** Team members an action's Owner refers to: by name first, then by role ("DSL", "SENCo", "Deputy head"). */
  function owners(team, ownerText) {
    const o = norm(ownerText);
    if (!o) return [];
    const byName = (team || []).filter(m => norm(m.name) && (norm(m.name) === o || o.split(" and ").map(x => x.trim()).includes(norm(m.name))));
    if (byName.length) return byName;
    return (team || []).filter(m => [m.role, LABEL[m.role], SHORT[m.role]].map(norm).includes(o) || (m.role === "head" && ["headteacher", "principal", "head teacher"].includes(o)) || (m.role === "dsl" && o === "designated safeguarding lead"));
  }
  const keyLeaders = team => (team || []).filter(m => KEY.includes(m.role) && validEmail(m.email));

  const api = { ROLES, LABEL, SHORT, KEY, owners, keyLeaders, validEmail };
  root.HWWD = Object.assign(root.HWWD || {}, { leaders: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
