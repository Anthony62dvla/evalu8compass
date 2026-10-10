/*
 * Demo staff for trying a workshop without a real school (superadmin only)
 * ------------------------------------------------------------
 * Adds ten made-up staff (4 teachers, 3 teaching assistants, 3 senior leaders,
 * so role breakdowns show) with realistic answers: strong behaviour and
 * personal development, weaker SEND adaptation and attendance, senior leaders
 * a little more positive than other staff, some lines where views split, and a
 * few typical comments. The workshop is marked as demo data everywhere.
 */
const { itemsFor } = require("./aggregate");
const store = require("./store");

// How well each area is going in the made-up school (0 = not yet, 1 = met)
const AREA = { sg: 0.86, inc: 0.55, ct: 0.62, ach: 0.6, ab: 0.66, pd: 0.82, ey: 0.68, p16: 0.72, lg: 0.74, cm: 0.8 };
// Lines this school finds hard, whatever the area
const WEAK = [/send|adapt|ehc|support plan/i, /persistent|severe absence|attendance/i, /reading|phonics|catch-up/i, /assessment|check/i];
const COMMENTS = {
  weak: [
    "We've had training on this but it isn't consistent across departments yet.",
    "Depends a lot on the class and who is teaching it.",
    "I'm not sure what the expectation is here. It would help to have it written down.",
    "Some good practice, but it's not happening everywhere.",
    "Time is the issue. We know what to do but rarely get to do it well.",
    "Support staff aren't always included in the planning for this.",
  ],
  strong: [
    "This is a real strength. Pupils would say the same.",
    "Clear systems and everyone knows them.",
    "Much better than two years ago.",
  ],
  split: [
    "Leaders see this as done, but it doesn't always feel that way in classrooms.",
    "Varies between key stages.",
  ],
};
const ROLES = ["teacher", "teacher", "teacher", "teacher", "ta", "ta", "ta", "slt", "slt", "slt"];

function rng(seed) { let s = 0; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function addDemoStaff(s) {
  const rand = rng(s.code + Object.keys(s.participants).length);
  const pick = list => list[Math.floor(rand() * list.length)];
  const areas = itemsFor(s);
  // Each line gets a "true" state for the made-up school; staff answers vary a little around it
  const line = {};
  for (const a of areas) for (const it of a.items) {
    let q = (AREA[a.id] != null ? AREA[a.id] : 0.7) + (rand() - 0.5) * 0.3;
    if (WEAK.some(re => re.test(it.text))) q -= 0.3;
    line[it.id] = { q, split: rand() < 0.15 };            // about 1 line in 7 divides staff
  }
  for (const role of ROLES) {
    const pid = store.token(8);
    s.participants[pid] = { role, joinedAt: new Date().toISOString(), tokenHash: store.hash(store.token(16)), demo: true };
    const mine = (s.responses[pid] = {});
    for (const a of areas) {
      for (const it of a.items) {
        if (rand() < 0.04) continue; // a few skipped lines, as in real workshops
        const L = line[it.id];
        let v = L.q + (rand() - 0.5) * 0.3 + (role === "slt" ? 0.15 : 0);  // leaders a little more positive
        if (L.split) v += (rand() < 0.5 ? -0.35 : 0.35);
        const st = v > 0.62 ? "met" : v > 0.38 ? "part" : "no";
        let c = "";
        if (rand() < 0.07) c = st === "met" ? pick(COMMENTS.strong) : L.split && role !== "slt" ? pick(COMMENTS.split) : pick(COMMENTS.weak);
        mine[it.id] = { s: st, c };
      }
    }
  }
  s.demo = true;
  return ROLES.length;
}

module.exports = { addDemoStaff };
