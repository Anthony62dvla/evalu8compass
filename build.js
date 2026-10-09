/*
 * Builds single-file versions of the app (no server needed):
 *   dist/how-well-are-we-doing.html  — open in any browser, or host on any static site / SharePoint / Google Sites embed
 *   dist/artifact.html               — the same page without <html>/<head>/<body>, ready to publish as a Claude artifact
 * Run: node build.js
 */
const fs = require("fs");
const path = require("path");

const pub = path.join(__dirname, "public");
let html = fs.readFileSync(path.join(pub, "checklist.html"), "utf8");

html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, f) => `<style>\n${fs.readFileSync(path.join(pub, f), "utf8")}\n</style>`);
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, f) => `<script>\n${fs.readFileSync(path.join(pub, f), "utf8").replace(/<\/script/gi, "<\\/script")}\n</script>`);

const between = (a, b) => { const s = html.indexOf(a), e = html.indexOf(b); return html.slice(s + a.length, e).trim(); };
const head = between("<!-- build:head -->", "<!-- /build:head -->");
const body = between("<!-- build:body -->", "<!-- /build:body -->");

fs.mkdirSync(path.join(__dirname, "dist"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "dist", "how-well-are-we-doing.html"), html);
fs.writeFileSync(path.join(__dirname, "dist", "artifact.html"), `${head}\n${body}\n`);
console.log("Built dist/how-well-are-we-doing.html and dist/artifact.html");
