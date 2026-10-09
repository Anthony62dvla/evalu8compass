/*
 * Storage — keeps one self-assessment per browser in localStorage.
 * Swap load()/save() for API calls if you add accounts or a database later.
 */
(function (root) {
  const KEY = "hwwd-selfassessment-v2";
  const DEFAULT = () => ({
    version: 2,
    profile: { name: "EFE", type: "independent", phases: ["ks3", "ks4"], special: true, by: "", date: "" },
    answers: {},   // { itemId: "met" | "part" | "no" | "na" }
    notes: {},     // { itemId: "evidence or next step" }
    ai: {},        // { itemId: inspector suggestion object }
    review: null,  // last inspector review
    collapsed: {}, // { areaId: true }
  });

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return merge(JSON.parse(raw));
    } catch (e) {}
    return DEFAULT();
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }
  function merge(obj) {
    const d = DEFAULT();
    if (!obj || typeof obj !== "object") return d;
    return { ...d, ...obj, profile: { ...d.profile, ...(obj.profile || {}) } };
  }

  root.HWWD = Object.assign(root.HWWD || {}, { store: { load, save, merge, DEFAULT } });
})(window);
