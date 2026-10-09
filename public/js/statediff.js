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
  const MAPS = ["answers", "notes", "ai", "collapsed"];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function diff(prev, cur) {
    const p = prev || {}, c = cur || {};
    const set = {}, del = [];
    for (const m of [...MAPS, "profile"]) {
      const a = p[m] || {}, b = c[m] || {};
      for (const k of Object.keys(b)) if (!same(a[k], b[k])) set[`${m}.${k}`] = b[k];
      for (const k of Object.keys(a)) if (!(k in b)) del.push(`${m}.${k}`);
    }
    if (!same(p.review || null, c.review || null)) set.review = c.review || null;
    const pa = new Map((p.actions || []).map(x => [x.id, x])), ca = new Map((c.actions || []).map(x => [x.id, x]));
    const upsert = [...ca.values()].filter(x => !same(pa.get(x.id), x));
    const adel = [...pa.keys()].filter(id => !ca.has(id));
    const patch = {};
    if (Object.keys(set).length) patch.set = set;
    if (del.length) patch.del = del;
    if (upsert.length || adel.length) patch.actions = { upsert, del: adel };
    return patch;
  }

  function isEmpty(patch) { return !patch || (!patch.set && !patch.del && !patch.actions); }

  function apply(state, patch) {
    const s = JSON.parse(JSON.stringify(state || {}));
    for (const m of [...MAPS, "profile"]) if (!s[m] || typeof s[m] !== "object") s[m] = {};
    if (!Array.isArray(s.actions)) s.actions = [];
    for (const [path, v] of Object.entries((patch && patch.set) || {})) {
      if (path === "review") { s.review = v; continue; }
      const i = path.indexOf("."); if (i < 0) continue;
      const m = path.slice(0, i), k = path.slice(i + 1);
      if ((MAPS.includes(m) || m === "profile") && k) s[m][k] = v;
    }
    for (const path of (patch && patch.del) || []) {
      const i = path.indexOf("."); if (i < 0) continue;
      const m = path.slice(0, i), k = path.slice(i + 1);
      if (s[m] && typeof s[m] === "object") delete s[m][k];
    }
    const a = patch && patch.actions;
    if (a) {
      const gone = new Set(a.del || []);
      s.actions = s.actions.filter(x => !gone.has(x.id));
      for (const u of a.upsert || []) {
        const i = s.actions.findIndex(x => x.id === u.id);
        if (i >= 0) s.actions[i] = u; else s.actions.push(u);
      }
    }
    return s;
  }

  const api = { diff, apply, isEmpty, same };
  root.HWWD = Object.assign(root.HWWD || {}, { statediff: api });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
