// Imports a bulletin PDF through the editing screen in a headless Chromium, as a person
// would, and reports what came out. Development aid.
//
//   node tools/import_check.mjs some-bulletin.pdf out/import

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rm, copyFile } from "node:fs/promises";
import { resolve, extname, dirname, join } from "node:path";
import { homedir } from "node:os";

const [pdfPath, outDir = "out/import"] = process.argv.slice(2);
const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
                ".json": "application/json", ".bulletin": "application/json", ".png": "image/png", ".ttf": "font/ttf", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  const file = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  let body;
  try { body = await readFile(file); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const debugPort = 9400 + Math.floor(Math.random() * 400);
const profile = join(homedir(), "snap/chromium/common", `grammateus-import-${process.pid}`);
await mkdir(profile, { recursive: true });
await mkdir(outDir, { recursive: true });
const visiblePdf = join(profile, "input.pdf");               // snap Chromium can only read from here
await copyFile(pdfPath, visiblePdf);
const chrome = spawn("chromium", ["--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--window-size=1500,950", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
try {
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === "page"); } catch { await sleep(150); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map((a) => a.value || a.description).join(" "));
  };
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const shot = async (name) => writeFile(join(outDir, name), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
  const until = async (expression, tries = 300) => { for (let i = 0; i < tries; i++) { if (await ev(expression)) return true; await sleep(200); } return false; };

  await send("Runtime.enable"); await send("DOM.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/src/app/index.html` });
  await until("!!window.grammateus && !!window.grammateus.report()");

  // choose the PDF in the file picker
  await ev("window.confirm = () => true; document.getElementById('import').click()");
  const { root: docRoot } = (await send("DOM.getDocument")).result;
  const { nodeId } = (await send("DOM.querySelector", { nodeId: docRoot.nodeId, selector: "#pickpdf" })).result;
  await send("DOM.setFileInputFiles", { nodeId, files: [visiblePdf] });
  await ev("document.getElementById('pickpdf').dispatchEvent(new Event('change'))");
  const asked = await until("document.querySelector('#form h1')?.textContent === 'Import a bulletin PDF' || document.getElementById('status').className === 'warn' || /made by Grammateus/.test(document.getElementById('status').textContent)");
  await sleep(2500);
  console.log("after reading:", await ev("document.getElementById('status').textContent"));
  if (await ev("/made by Grammateus/.test(document.getElementById('status').textContent)")) {
    console.log("opened from the copy stored in the PDF:", await ev(`(() => { const d = JSON.parse(window.grammateus.serialise()); return JSON.stringify({ title: d.meta.title, parts: d.parts.map(p => p.name + ': ' + p.blocks.length), images: Object.keys(d.images).length, report: window.grammateus.report() }); })()`));
    console.log("errors on the page:", errors.length ? errors.slice(0, 5) : "none");
    process.exitCode = 0;
    throw Object.assign(new Error("done"), { done: true });
  }
  console.log("suggested service pages:", await ev("[...document.querySelectorAll('#form input[type=number]')].map(i => i.value).join(' to ')"));
  await shot("1-page-numbers.png");
  if (!asked || await ev("document.getElementById('status').className === 'warn'")) throw new Error("the PDF was not read");

  await ev("document.querySelector('#form button.primary').click()");
  await until("document.querySelector('#form h1')?.textContent === 'Cover' || document.getElementById('status').className === 'warn'");
  await sleep(3500);
  console.log("after import:", await ev("document.getElementById('status').textContent"));
  const summary = await ev(`(() => { const d = JSON.parse(window.grammateus.serialise()); const kinds = (list) => list.reduce((k, b) => (k[b.type] = (k[b.type] || 0) + 1, k), {});
    return JSON.stringify({ meta: d.meta, footer: d.cover.footer, parts: d.parts.map(p => ({ name: p.name, side: p.side, size: p.size, last: !!p.last, kinds: kinds(p.blocks), notes: p.blocks.filter(b => b.note).length })),
      images: Object.keys(d.images).length, style: d.style, megabytes: +(window.grammateus.serialise().length / 1e6).toFixed(2), report: window.grammateus.report() }); })()`);
  console.log(summary);
  await writeFile(join(outDir, "imported.bulletin"), await ev("window.grammateus.serialise()"));
  await shot("2-imported.png");
  const pdf = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
  await writeFile(join(outDir, "imported.pdf"), Buffer.from(pdf.result.data, "base64"));
  console.log("errors on the page:", errors.length ? errors.slice(0, 5) : "none");
} catch (e) {
  if (!e.done) throw e;
} finally {
  ws?.close(); chrome.kill(); server.close(); await sleep(300); await rm(profile, { recursive: true, force: true });
}
