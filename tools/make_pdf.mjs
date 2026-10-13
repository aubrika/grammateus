// Makes the two PDFs for a bulletin from the command line, using a headless Chromium:
//   <name>-reading.pdf   pages in reading order, for proofreading and for the screen
//   <name>-print.pdf     pages arranged on 11x17 sheets for folding
//
//   node tools/make_pdf.mjs samples/2026-08-23/bulletin.json out/
//
// The desktop app will do the same through its own built-in browser; this script is the
// development and testing path.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, extname, basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { impose } from "../src/impose.mjs";
import { embedBulletin } from "../src/pdf_embed.mjs";

const [docPath, outDir = "out"] = process.argv.slice(2);
if (!docPath) { console.error("usage: node tools/make_pdf.mjs <bulletin.json> [out-dir]"); process.exit(2); }
const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
                ".png": "image/png", ".jpg": "image/jpeg", ".ttf": "font/ttf" };

// Serve the program's files as they are, and the bulletin's own folder under /doc/.
const docDir = dirname(resolve(docPath));
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.startsWith("/doc/") ? join(docDir, path.slice(5)) : join(root, path);
  let body;
  try { body = await readFile(file); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const debugPort = 9400 + Math.floor(Math.random() * 400);
const profile = join(homedir(), "snap/chromium/common", `bulletin-${process.pid}`);   // snap Chromium can only write here
await mkdir(profile, { recursive: true });
const chrome = spawn(process.env.CHROMIUM || "chromium", ["--headless=new", `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
try {
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find((t) => t.type === "page"); }
    catch { await sleep(150); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });

  await send("Page.navigate", { url: `http://127.0.0.1:${port}/src/renderer/print.html?doc=/doc/${encodeURIComponent(basename(docPath))}` });
  let report;
  for (let i = 0; i < 200 && !report; i++) {
    await sleep(150);
    const r = await send("Runtime.evaluate", { expression: "JSON.stringify(window.__report || null)", returnByValue: true });
    report = JSON.parse(r.result?.result?.value || "null");
  }
  if (!report || report.error) throw new Error(report ? report.error : "layout did not finish");

  const pdf = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true,
    marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
  let reading = Buffer.from(pdf.result.data, "base64");
  const source = await readFile(docPath, "utf8");
  // a single-file bulletin (pictures inside) is stored in the PDF, as the desktop program does
  if (Object.keys(JSON.parse(source).images || {}).length) reading = Buffer.from(await embedBulletin(reading, source));
  await mkdir(outDir, { recursive: true });
  const name = basename(dirname(resolve(docPath)));
  await writeFile(join(outDir, `${name}-reading.pdf`), reading);
  await writeFile(join(outDir, `${name}-print.pdf`), await impose(reading));
  console.log(JSON.stringify(report));
} finally {
  ws?.close();
  chrome.kill();
  server.close();
  await sleep(300);
  await rm(profile, { recursive: true, force: true });
}
