/*
 * Builds the downloadable user guide: public/guide/evalu8-compass-user-guide.pdf
 *   node scripts/build-guide.js            take fresh screenshots, then build the PDF
 *   node scripts/build-guide.js --reuse    rebuild the PDF from the last screenshots
 * Needs Playwright with Chromium (developer machine only; not needed on the server).
 * Re-run it whenever the screens change, then commit the new PDF.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const SHOTS = path.join(os.tmpdir(), "evalu8-guide-shots");
const OUT = path.join(ROOT, "public", "guide", "evalu8-compass-user-guide.pdf");

global.window = {};
require(path.join(ROOT, "public", "js", "icons.js"));
const icon = (name, size) => global.window.HWWD.icon(name, size || 24);

(async () => {
  if (!process.argv.includes("--reuse") || !fs.existsSync(SHOTS)) {
    console.log("Taking screenshots…");
    const made = await require("./guide/shots")(SHOTS);
    console.log("  " + made.length + " screenshots");
  }
  const date = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  let html = fs.readFileSync(path.join(__dirname, "guide", "guide.html"), "utf8")
    .replace(/\{\{ROOT\}\}/g, "file://" + ROOT)
    .replace(/\{\{DATE\}\}/g, date)
    .replace(/\{\{ICON:([a-z0-9-]+)\}\}/g, (_, n) => icon(n))
    .replace(/\{\{IMG:([a-z0-9-]+)\}\}/g, (_, n) => {
      const f = path.join(SHOTS, n + ".jpg");
      if (!fs.existsSync(f)) throw new Error("Missing screenshot " + n);
      return "file://" + f;
    });
  const tmp = path.join(SHOTS, "guide.html");
  fs.writeFileSync(tmp, html);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + tmp, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await page.pdf({
    path: OUT, format: "A4", printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;font:8px Arial,sans-serif;color:#4B5E59;padding:0 16mm;display:flex;justify-content:space-between"><span>Evalu8 Compass · How to use it</span><span class="pageNumber"></span></div>`,
    tagged: true, outline: true,
  });
  await browser.close();
  console.log("Wrote " + path.relative(ROOT, OUT) + " (" + Math.round(fs.statSync(OUT).size / 1024) + " KB)");
})().catch(e => { console.error(e); process.exit(1); });
