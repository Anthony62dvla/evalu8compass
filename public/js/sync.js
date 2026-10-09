/*
 * Evalu8 Compass — saving to the school's account
 * ------------------------------------------------------------
 * The checklist and action plan are saved on the server under the school's
 * access code, so everyone on the leadership team sees the same copy on any
 * device. A copy is also kept in this browser so nothing is lost if the
 * connection drops; changes made offline are sent when it comes back.
 *
 *   base  = the copy the server last confirmed
 *   state = what's on screen (base + this device's unsent changes)
 * Saves send diff(base, state). When colleagues save, their copy becomes the
 * new base and this device's unsent changes are re-applied on top.
 */
(function (root) {
  const S = root.HWWD.store, D = root.HWWD.statediff;
  const LEGACY_DONE = "hwwd-legacy-moved";
  const LAST_OWNER = "hwwd-sync-owner";
  const cacheKey = o => "hwwd-sync-v1:" + o;
  const POLL_MS = 20000;
  const clone = o => JSON.parse(JSON.stringify(o));
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };
  const hasWork = st => !!st && (Object.keys(st.answers || {}).length > 0 || (st.actions || []).length > 0 || Object.keys(st.notes || {}).length > 0);

  let mode = "local";            // "server" once the school's copy is loaded; "local" for file copies
  let owner = null, rev = 0, base = null, state = null;
  let sending = false, timer = null, pollTimer = null, retryMs = 5000, signedOut = false;
  let status = "idle", statusDetail = "";
  const listeners = { status: [], remote: [] };
  let canApply = () => true;

  function served() { return location.protocol !== "file:" && !!document.querySelector('link[href="css/styles.css"]'); }
  function setStatus(s, detail) { status = s; statusDetail = detail || ""; listeners.status.forEach(f => f(s, statusDetail)); }
  function writeCache() {
    if (mode !== "server") { S.save(state); return; }
    ls.set(cacheKey(owner), { owner, rev, base, state });
  }
  async function call(method, path, body) {
    const r = await fetch("api/school" + path, {
      method, credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || "Couldn't reach the server."), { status: r.status });
    return d;
  }

  /** Load the school's copy. Resolves to { state, mode, legacy } where legacy is an
   *  earlier copy found only in this browser that differs from the shared one. */
  async function start(opts) {
    canApply = (opts && opts.canApply) || canApply;
    if (!served()) { mode = "local"; state = S.load(); return { state, mode }; }
    let r;
    try { r = await call("GET", ""); }
    catch (e) {
      // Offline, or signed out: carry on with the last copy kept on this device
      const o = ls.get(LAST_OWNER), c = o && ls.get(cacheKey(o));
      if (c && c.state) {
        mode = "server"; owner = o; rev = c.rev; base = S.merge(c.base); state = S.merge(c.state);
        if (e.status === 401) { signedOut = true; setStatus("signedout"); } else { setStatus("offline"); retrySoon(); }
        return { state, mode };
      }
      if (e.status === 401) { location.href = "enter.html?next=" + encodeURIComponent(location.pathname + location.search + location.hash); return new Promise(() => {}); }
      mode = "local"; state = S.load(); setStatus("localonly");
      return { state, mode };
    }
    mode = "server"; owner = r.owner; ls.set(LAST_OWNER, owner);
    const cached = ls.get(cacheKey(owner));
    const legacy = ls.get(LEGACY_DONE) === owner ? null : S.load();
    let legacyOffer = null;

    if (!r.state) {
      // First time this school saves on the server: bring this device's work across
      const start = cached && cached.state ? S.merge(cached.state) : hasWork(legacy) ? legacy : S.DEFAULT();
      if (r.school && !start.profile.name) start.profile.name = r.school;
      base = S.DEFAULT(); rev = 0; state = start;
      if (hasWork(legacy)) ls.set(LEGACY_DONE, owner);
      if (hasWork(state) || state.profile.name) {
        try { const p = await call("PUT", "", { state }); rev = p.rev; base = S.merge(p.state); state = clone(base); }
        catch (e) { setStatus("offline"); retrySoon(); }
      }
    } else {
      base = S.merge(r.state); rev = r.rev; state = clone(base);
      if (cached && cached.state && cached.base) {
        // Re-apply anything this device changed but hadn't sent yet
        const pending = D.diff(S.merge(cached.base), S.merge(cached.state));
        if (!D.isEmpty(pending)) { state = S.merge(D.apply(base, pending)); schedule(200); }
      } else if (hasWork(legacy) && !D.same(S.merge(legacy).answers, base.answers)) {
        legacyOffer = legacy;  // ask which copy to keep (see useLegacy / keepShared)
      } else if (hasWork(legacy)) ls.set(LEGACY_DONE, owner);
    }
    writeCache();
    if (status !== "offline") setStatus("saved");
    startPolling();
    return { state, mode, legacy: legacyOffer, school: r.school || "" };
  }

  /* ---------- saving ---------- */
  function changed(next) {
    state = next;
    writeCache();
    if (mode !== "server") return;
    if (signedOut) { setStatus("signedout"); return; }
    setStatus("pending");
    schedule(800);
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(send, ms); }
  function retrySoon() {
    clearTimeout(timer);
    timer = setTimeout(send, retryMs);
    retryMs = Math.min(retryMs * 2, 60000);
  }
  async function send() {
    if (mode !== "server" || sending || signedOut) return;
    const patch = D.diff(base, state);
    if (D.isEmpty(patch)) { setStatus("saved"); return; }
    sending = true; setStatus("saving");
    const sent = clone(state);
    try {
      const r = await call("PATCH", "", { baseRev: rev, patch });
      const newBase = r.state ? S.merge(r.state) : S.merge(D.apply(base, patch));
      const later = D.diff(sent, state);           // typed while this save was on its way
      base = newBase; rev = r.rev; retryMs = 5000;
      if (r.state) { state = S.merge(D.apply(base, later)); notifyRemote(); }
      sending = false; writeCache();
      if (!D.isEmpty(later)) schedule(300); else setStatus("saved");
    } catch (e) {
      sending = false;
      if (e.status === 401) { signedOut = true; setStatus("signedout"); return; }
      if (e.status === 413 || e.status === 400) { setStatus("error", e.message); return; }
      setStatus("offline"); retrySoon();
    }
  }
  /** Save now (before a snapshot, or leaving the page). */
  async function flush() {
    clearTimeout(timer);
    for (let i = 0; i < 20 && sending; i++) await new Promise(r => setTimeout(r, 150));
    await send();
    return status === "saved";
  }

  /* ---------- colleagues' changes ---------- */
  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => { if (!document.hidden) poll(); }, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
    window.addEventListener("online", () => { retryMs = 5000; send(); poll(); });
    window.addEventListener("pagehide", () => {
      // Last-chance save; the copy on this device is already safe either way
      const patch = mode === "server" && !signedOut ? D.diff(base, state) : null;
      if (patch && !D.isEmpty(patch) && !sending) {
        try { fetch("api/school", { method: "PATCH", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ baseRev: rev, patch }) }); } catch (e) {}
      }
    });
  }
  async function poll() {
    if (mode !== "server" || sending || signedOut) return;
    try {
      const r = await call("GET", "?rev=" + rev);
      if (r.same || sending) { if (status === "offline") { retryMs = 5000; send(); } return; }
      if (!canApply()) return;                        // e.g. mid-way through something; try next time
      const mine = D.diff(base, state);
      base = S.merge(r.state); rev = r.rev;
      state = S.merge(D.apply(base, mine));
      writeCache(); notifyRemote();
      if (!D.isEmpty(mine)) schedule(300);
    } catch (e) {
      if (e.status === 401) { signedOut = true; setStatus("signedout"); }
      else if (status !== "offline") setStatus("offline");
    }
  }
  function notifyRemote() { listeners.remote.forEach(f => f(state)); }

  /* ---------- earlier copy on this device ---------- */
  async function useLegacy(legacy) {
    const r = await call("PUT", "", { state: legacy });
    base = S.merge(r.state); rev = r.rev; state = clone(base);
    ls.set(LEGACY_DONE, owner); writeCache(); setStatus("saved");
    return state;
  }
  function keepShared() { ls.set(LEGACY_DONE, owner); }

  /* ---------- snapshots ---------- */
  const snapshots = {
    list: () => call("GET", "/snapshots").then(d => d.snapshots),
    get: id => call("GET", "/snapshots/" + id),
    async create(name) {
      if (!(await flush())) throw new Error("Your latest changes haven't saved yet, so the snapshot wasn't taken. Check your connection and try again.");
      return call("POST", "/snapshots", { name });
    },
    remove: id => call("DELETE", "/snapshots/" + id),
  };

  /** One-off read for other pages (the report): the shared copy plus this device's unsent changes. */
  async function read() {
    if (!served()) return { state: S.load(), mode: "local" };
    try {
      const r = await call("GET", "");
      let st = r.state ? S.merge(r.state) : S.DEFAULT();
      const c = ls.get(cacheKey(r.owner));
      if (c && c.base && c.state && r.state) st = S.merge(D.apply(st, D.diff(S.merge(c.base), S.merge(c.state))));
      else if (!r.state && c && c.state) st = S.merge(c.state);
      return { state: st, mode: "server", rev: r.rev };
    } catch (e) {
      const o = ls.get(LAST_OWNER), c = o && ls.get(cacheKey(o));
      if (c && c.state) return { state: S.merge(c.state), mode: "server", offline: true };
      return { state: S.load(), mode: "local" };
    }
  }

  root.HWWD = Object.assign(root.HWWD || {}, { sync: {
    start, changed, flush, read, useLegacy, keepShared, snapshots,
    onStatus: f => { listeners.status.push(f); f(status, statusDetail); },
    onRemote: f => listeners.remote.push(f),
    mode: () => mode, status: () => status,
  } });
})(window);
