/* Checks criteria.js for duplicate ids and shows how many lines each school profile gets. Run: node scripts/validate-criteria.js */
const C = require("../public/js/criteria.js");
const ids = new Set(); let errors = 0;
for (const a of C.AREAS) for (const i of a.items) {
  if (ids.has(i.id)) { console.error("Duplicate id:", i.id); errors++; }
  ids.add(i.id);
  if (!i.t || !i.e) { console.error("Missing text or evidence:", i.id); errors++; }
}
const profiles = [
  ["Maintained primary", { type: "maintained", phases: ["eyfs", "ks1", "ks2"], special: false }],
  ["Academy secondary + sixth form", { type: "academy", phases: ["ks3", "ks4", "p16"], special: false }],
  ["Independent all-through", { type: "independent", phases: ["eyfs", "ks1", "ks2", "ks3", "ks4", "p16"], special: false }],
  ["Independent special KS3–4", { type: "independent", phases: ["ks3", "ks4"], special: true }],
];
for (const [name, ctx] of profiles) {
  const v = C.resolve(ctx);
  console.log(`${name.padEnd(32)} ${String(v.reduce((s, a) => s + a.items.length, 0)).padStart(3)} lines · ${v.map(a => a.name).join(", ")}`);
}
console.log(`${ids.size} criteria, ${errors} problems`);
process.exit(errors ? 1 : 0);
