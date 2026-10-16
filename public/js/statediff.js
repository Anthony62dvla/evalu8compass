/*
 * Evalu8 Compass — checklist state diff and merge (shared by browser and server)
 * ------------------------------------------------------------
 * Saves send only what changed, key by key, so two leaders editing different
 * lines at the same time don't overwrite each other. If both change the same
 * line, the later save wins for that line only.
 *
 * Patch shape:
 *   { set: { "answers.sg-dsl": "no", "profile.name": "...", "review": {...} },
 *     del: [ "notes.sg-dsl" ],
 *     actions: { upsert: [ {id, ...} ], del: [ "a1b2" ] } }
 */
(function (root) {
  const MAPS = ["answers", "notes", "ai", "collapsed", "leads", "siams"];   // siams: last inspection, context, and each Inspection Question   // leads: each evaluation area's leader report (commentary, key figures)
  const LISTS = ["actions", "team", "meetings", "subjects", "monitoring", "govReports", "challenges"];   // arrays of { id, … }: changes merge item by item
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function diff(prev, cur) {
    const p = prev || {}, c = cur || {};
    const set = {}, del = [];
    for (const m of [...MAPS, "profile"]) {
      const a = p[m] || {}, b = c[m] || {};
      for (const k of Object.keys(b)) if (!same(a[k], b[k])) set[`${m}.${k}`] = b[k];
      for (const k of Object.keys(a)) if (!(k in b)) del.push(`${m}.${k}`);
    }
    for (const k of ["review", "ofsted"]) if (!same(p[k] || null, c[k] || null)) set[k] = c[k] || null;
    const patch = {};
    if (Object.keys(set).length) patch.set = set;
    if (del.length) patch.del = del;
    for (const l of LISTS) {
      const pa = new Map((p[l] || []).map(x => [x.id, x])), ca = new Map((c[l] || []).map(x => [x.id, x]));
      const upsert = [...ca.values()].filter(x => !same(pa.get(x.id), x));
      const adel = [...pa.keys()].filter(id => !ca.has(id));
      if (upsert.length || adel.length) patch[l] = { upsert, del: adel };
    }
    return patch;
  }

  function isEmpty(patch) { return !patch || (!patch.set && !patch.del && !LISTS.some(l => patch[l])); }

  function apply(state, patch) {
    const s = JSON.parse(JSON.stringify(state || {}));
    for (const m of [...MAPS, "profile"]) if (!s[m] || typeof s[m] !== "object") s[m] = {};
    for (const l of LISTS) if (!Array.isArray(s[l])) s[l] = [];
    for (const [path, v] of Object.entries((patch && patch.set) || {})) {
      if (path === "review" || path === "ofsted") { s[path] = v; continue; }
      const i = path.indexOf("."); if (i < 0) continue;
      const m = path.slice(0, i), k = path.slice(i + 1);
      if ((MAPS.includes(m) || m === "profile") && k) s[m][k] = v;
    }
    for (const path of (patch && patch.del) || []) {
      const i = path.indexOf("."); if (i < 0) continue;
      const m = path.slice(0, i), k = path.slice(i + 1);
      if (s[m] && typeof s[m] === "object") delete s[m][k];
    }
    for (const l of LISTS) {
      const a = patch && patch[l];
      if (!a) continue;
      const gone = new Set(a.del || []);
      s[l] = s[l].filter(x => !gone.has(x.id));
      for (const u of a.upsert || []) {
        if (!u || typeof u.id !== "string") continue;
        const i = s[l].findIndex(x => x.id === u.id);
        const v = JSON.parse(JSON.stringify(u));   // a copy: the result must never share objects with the patch (or the screen's state)
        if (i >= 0) s[l][i] = v; else s[l].push(v);
      }
    }
    return s;
  }

  const api = { diff, apply, isEmpty, same, LISTS };
  root.HWWD = Object.assign(root.HWWD || {}, { statediff: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
