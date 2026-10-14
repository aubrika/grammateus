// Drives the editing screen in a headless Chromium, the way a person would, and saves
// screenshots and a PDF. Development aid, not part of the program.
//
//   node tools/ui_check.mjs out/2026-10-11.bulletin out/ui

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { resolve, extname, dirname, join, basename } from "node:path";
import { homedir } from "node:os";

const [docPath, outDir = "out/ui"] = process.argv.slice(2);
const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
                ".bulletin": "application/json", ".png": "image/png", ".ttf": "font/ttf", ".mjs": "text/javascript", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.startsWith("/doc/") ? resolve(dirname(docPath), path.slice(5)) : join(root, path);
  let body;
  try { body = await readFile(file); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(body);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
const debugPort = 9400 + Math.floor(Math.random() * 400);
const profile = join(homedir(), "snap/chromium/common", `grammateus-ui-${process.pid}`);
await mkdir(profile, { recursive: true });
await mkdir(outDir, { recursive: true });
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
  const settle = async () => { for (let i = 0; i < 100; i++) { await sleep(200); if (await ev("!!window.grammateus && !!window.grammateus.report() && document.querySelectorAll('#shown .page').length > 0")) break; } await sleep(700); };

  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${port}/src/app/index.html?doc=/doc/${encodeURIComponent(basename(docPath))}` });
  await settle();
  console.log("opened:", JSON.stringify(await ev("window.grammateus.report()")), "| status:", await ev("document.getElementById('status').textContent"));
  await shot("1-opened.png");

  // click a heading in the outline, then type into its field as a person would
  await ev(`[...document.querySelectorAll('#outline .row.heading')].find(b => b.textContent.includes('Prayer of the Day')).click()`);
  await sleep(400);
  await ev(`(() => { const i = document.querySelector('#form input[type=text]'); i.focus(); i.value = 'Prayer of the Day (edited)'; i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await sleep(1500);
  console.log("after edit, preview shows it:", await ev(`[...document.querySelectorAll('#shown .heading')].some(h => h.textContent.includes('(edited)'))`),
    "| outline shows it:", await ev(`[...document.querySelectorAll('#outline .row')].some(h => h.textContent.includes('(edited)'))`),
    "| status:", await ev("document.getElementById('status').textContent"));
  await shot("2-heading-edited.png");

  // undo takes the edit away and redo brings it back
  const edited = `[...document.querySelectorAll('#outline .row')].some(h => h.textContent.includes('(edited)'))`;
  await sleep(700);
  await ev("document.getElementById('undo').click()"); await sleep(600);
  const afterUndo = await ev(edited);
  await ev("document.getElementById('redo').click()"); await sleep(600);
  console.log("undo removes the edit:", afterUndo === false, "| redo restores it:", await ev(edited),
    "| pictures still there after undo:", await ev("Object.keys(JSON.parse(window.grammateus.serialise()).images).length > 0"));
  await sleep(1200);

  // click a paragraph in the preview: the form should switch to it
  await ev(`document.querySelector('#shown p.text').click()`);
  await sleep(500);
  console.log("clicked preview text, form title:", await ev("document.querySelector('#form h1').textContent"));
  await shot("3-text-selected.png");

  // add a whole sheet, then take it away again
  const before = await ev("window.grammateus.report().pages");
  await ev("document.getElementById('more').click()"); await sleep(1800);
  const more = await ev("window.grammateus.report().pages");
  await ev("document.getElementById('fewer').click()"); await sleep(1800);
  console.log("pages:", before, "→ with an extra sheet:", more, "→ removed again:", await ev("window.grammateus.report().pages"));

  // every part takes every kind of item: add a heading and some text to the last-but-one part
  const partRow = `[...document.querySelectorAll('#outline .row.part.title')].at(-2)`;
  const partName = await ev(`${partRow}.childNodes[0].textContent`);
  await ev(`${partRow}.click()`); await sleep(300);
  await ev(`[...document.querySelectorAll('#form .add button')].find(b => b.textContent === 'Heading').click()`); await sleep(300);
  await ev(`(() => { const i = document.querySelector('#form input[type=text]'); i.value = 'Added by the check'; i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await ev(`[...document.querySelectorAll('#form .add button')].find(b => b.textContent === 'Text').click()`); await sleep(300);
  await ev(`(() => { const b = document.querySelector('#form .rich .box'); b.focus(); document.execCommand('insertText', false, 'Coffee hour follows the service. All are welcome.'); })()`);
  await sleep(1800);
  console.log(`added to "${partName}":`, await ev(`[...document.querySelectorAll('#shown .heading')].some(h => h.textContent.includes('Added by the check'))`));

  // side notes can be switched on for a part that did not have them
  await ev(`${partRow}.click()`); await sleep(300);
  const sideBox = `[...document.querySelectorAll('#form label.check')].find(l => l.textContent.includes('side column')).querySelector('input')`;
  const had = await ev(`${sideBox}.checked`);
  await ev(`${sideBox}.click()`); await sleep(1800);
  console.log("side column was", had ? "on" : "off", "→ pages of that part now have a side column:", await ev(`!!document.querySelector('#shown .page[data-part="' + (document.querySelectorAll('#outline .row.part.title').length - 2) + '"] .side')`));
  await ev(`${sideBox}.click()`); await sleep(1500);

  // a font for one item, then for every item of its kind
  await ev(`[...document.querySelectorAll('#outline .row.heading')][0].click()`); await sleep(300);
  await ev(`(() => { const i = document.querySelector('#form .fontrow input'); i.focus(); i.value = 'Georgia'; i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await sleep(1500);
  const fontsOf = `[...document.querySelectorAll('#shown .heading')].filter(h => h.style.fontFamily.includes('Georgia')).length`;
  const one = await ev(fontsOf);
  await ev(`document.querySelector('#form .fontrow > button').click()`); await sleep(1500);
  console.log("headings in Georgia: after setting one item:", one, "→ after 'use for all headings':", await ev(fontsOf), "of", await ev(`document.querySelectorAll('#shown .heading').length`),
    "| status:", await ev("document.getElementById('status').textContent.slice(0, 40)"));

  // hiding the outline, and clicking the page without the view jumping
  await ev("document.getElementById('toggle').click()"); await sleep(300);
  const hidden = await ev("getComputedStyle(document.getElementById('outline')).display === 'none'");
  await ev("document.getElementById('preview').scrollTop = 900"); await sleep(200);
  const scrollBefore = await ev("document.getElementById('preview').scrollTop");
  await ev(`(() => { const pages = [...document.querySelectorAll('#shown .page')]; pages[2].click(); })()`); await sleep(500);
  const afterPaper = await ev("document.getElementById('preview').scrollTop");
  await ev(`[...document.querySelectorAll('#shown .page')][2].querySelector('[data-index]').click()`); await sleep(700);
  console.log("outline hidden:", hidden, "| clicking empty paper moved the view:", afterPaper !== scrollBefore, "| clicking an item moved the view:", await ev("document.getElementById('preview').scrollTop") !== scrollBefore,
    "| item chosen:", await ev("document.querySelector('#form h1').textContent"));
  await ev("document.getElementById('toggle').click()"); await sleep(300);

  // a new part can be added and removed
  const partsBefore = await ev(`document.querySelectorAll('#outline .row.part.title').length`);
  await ev(`document.querySelector('#outline .row.part.add').click()`); await sleep(500);
  const partsAfter = await ev(`document.querySelectorAll('#outline .row.part.title').length`);
  await ev(`window.confirm = () => true; [...document.querySelectorAll('#form .tools button')].find(b => b.textContent === 'Remove this part').click()`); await sleep(500);
  console.log("parts:", partsBefore, "→ after adding one:", partsAfter, "→ after removing it:", await ev(`document.querySelectorAll('#outline .row.part.title').length`),
    "| back cover still last:", await ev(`JSON.parse(window.grammateus.serialise()).parts.at(-1).last === true`));
  await shot("4-parts.png");

  // enlarging the text to fill the sheets, and undoing it
  const sizes = `(d => 'default ' + d.style.size + ', parts ' + d.parts.map(p => p.size || '-').join(', ') + ', notes ' + (d.style.sizes.note || 'usual'))(JSON.parse(window.grammateus.serialise()))`;
  const sizesBefore = await ev(sizes), reportBefore = await ev("JSON.stringify([window.grammateus.report().pages, window.grammateus.report().blankPages])");
  await ev(`window.__seen = []; window.__t = setInterval(() => { const b = document.getElementById('busy'); if (!b.hidden) window.__seen.push(document.getElementById('busypct').textContent); }, 25)`);
  await ev("window.grammateus.fitToSheets()");
  await sleep(1200);
  console.log("enlarge to fill: sizes", sizesBefore, "→", await ev(sizes), "| pages and blanks", reportBefore, "→", await ev("JSON.stringify([window.grammateus.report().pages, window.grammateus.report().blankPages])"),
    "| progress readings:", await ev("new Set(window.__seen).size"), "| panel hidden after:", await ev("clearInterval(window.__t), document.getElementById('busy').hidden"));
  console.log("  status:", await ev("document.getElementById('status').textContent"));
  await sleep(800);
  await ev("document.getElementById('undo').click()"); await sleep(1800);
  console.log("  after undo, sizes:", await ev(sizes));

  // paste from Word: formatting we keep survives, the rest is dropped
  console.log("paste cleaning:", await ev(`(async () => { const { cleanHtml } = await import('/src/app/doc.js'); return cleanHtml('<p class="MsoNormal" style="margin:0"><span style="font-family:Calibri;color:red">The Lord be with you.</span></p><p class="MsoNormal"><b><span style="font-size:14pt">And also with you.</span></b></p><script>alert(1)</script>'); })()`));

  // saved file round-trips
  console.log("save and reopen gives the same pages:", await ev(`(async () => { const text = window.grammateus.serialise(); const n = window.grammateus.report().pages; window.grammateus.load(text, 'x.bulletin'); await new Promise(r => setTimeout(r, 2500)); return window.grammateus.report().pages === n && !window.grammateus.isDirty(); })()`));

  // the font box: the arrow is always there and opens the whole list, whatever is typed in the box
  await ev(`[...document.querySelectorAll('#outline .row.heading')][0].click()`); await sleep(400);
  await ev(`document.querySelector('#form .fontbox input').scrollIntoView({ block: 'center' })`);
  await ev(`document.querySelector('#form .fontbox .arrow').click()`); await sleep(500);
  console.log("font list after pressing the arrow:", await ev(`(() => { const m = document.querySelector('#form .fontbox .menu'); return m.children.length + ' entries, scrolls: ' + (m.scrollHeight > m.clientHeight) + ', box holds: ' + JSON.stringify(document.querySelector('#form .fontbox input').value); })()`));
  await shot("6-fonts.png");
  await ev(`document.querySelector('#form .fontbox .menu button:nth-child(4)').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))`); await sleep(1200);
  console.log("chosen from the list:", await ev(`document.querySelector('#form .fontbox input').value`), "| list closed:", await ev(`document.querySelector('#form .fontbox .menu').hidden`));

  // the font for the whole bulletin, and the size of side notes, reach the preview as well as the PDF
  await ev(`document.querySelector('#outline .row.design').click()`); await sleep(400);
  await ev(`(() => { const i = document.querySelector('#form .fontbox input'); i.focus(); i.value = 'Verdana'; i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await sleep(1800);
  console.log("whole-bulletin font set to Verdana → preview text uses:", await ev(`getComputedStyle(document.querySelector('#shown .main .text')).fontFamily.split(',')[0]`),
    "| preview note size matches the pages:", await ev(`getComputedStyle(document.querySelector('#shown .side .note')).fontSize === getComputedStyle(document.querySelector('#pages .side .note')).fontSize`));
  await ev("document.getElementById('undo').click()"); await sleep(1500);

  // a text size for every item of one kind, set under Design
  await ev(`document.querySelector('#outline .row.design').click()`); await sleep(400);
  const headingSize = `getComputedStyle(document.querySelector('#shown .heading')).fontSize`;
  const sizeBefore = await ev(headingSize);
  await ev(`(() => { const row = [...document.querySelectorAll('#form label')].find(l => l.textContent === 'Headings').nextElementSibling; const i = row.querySelector('.sizebox input'); i.value = '20'; i.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await sleep(1800);
  console.log("headings:", sizeBefore, "→ with 20 pt for all headings:", await ev(headingSize), "(20 pt is 26.67px) | all headings that size:",
    await ev(`[...document.querySelectorAll('#shown .heading')].every(h => getComputedStyle(h).fontSize === '26.6667px')`), "| text unchanged:", await ev(`getComputedStyle(document.querySelector('#shown .main .text')).fontSize`));
  await ev("document.getElementById('undo').click()"); await sleep(1500);
  console.log("  after undo:", await ev(headingSize));

  // other paper sizes, and a white side column
  await ev(`document.querySelector('#outline .row.design').click()`); await sleep(400);
  const pageInfo = `(() => { const p = document.querySelector('#pages .page'); const r = p.getBoundingClientRect(); return (r.width / 96).toFixed(2) + ' x ' + (r.height / 96).toFixed(2) + ' in, ' + window.grammateus.report().pages + ' pages, default size ' + JSON.parse(window.grammateus.serialise()).style.size + ' pt'; })()`;
  const letterInfo = await ev(pageInfo);
  await ev(`(() => { const s = document.querySelector('#form select'); s.value = 'half-letter'; s.dispatchEvent(new Event('change', {bubbles:true})); })()`); await sleep(2500);
  console.log("paper: letter", letterInfo, "→ half letter", await ev(pageInfo), "| print size:", await ev(`document.getElementById('paper-size').textContent`),
    "| preview page width matches:", await ev(`document.querySelector('#shown .page').offsetWidth === document.querySelector('#pages .page').offsetWidth`));
  console.log("  status:", await ev("document.getElementById('status').textContent.slice(0, 90)"));
  await shot("7-half-letter.png");
  await ev("document.getElementById('form').scrollTop = 0"); await sleep(200);
  const sideBg = `getComputedStyle(document.querySelector('#shown .side')).backgroundColor`;
  const grey = await ev(sideBg);
  await ev(`[...document.querySelectorAll('#form label.check')].find(l => l.textContent.includes('White side column')).querySelector('input').click()`); await sleep(1800);
  console.log("side column:", grey, "→ with white chosen:", await ev(sideBg));
  await ev("document.getElementById('undo').click()"); await sleep(1500);
  await ev("document.getElementById('undo').click()"); await sleep(1800);
  console.log("after two undos:", await ev(pageInfo), "| side:", await ev(sideBg));

  // the progress panel, as it looks part of the way through an import
  await ev(`(() => { document.getElementById('busy').hidden = false; document.getElementById('busytext').textContent = 'Reading page 7 of 16…'; document.getElementById('busybar').value = 42; document.getElementById('busypct').textContent = '42% done'; })()`);
  await sleep(300);
  await shot("5-busy.png");
  console.log("spinner arc turning:", await ev("getComputedStyle(document.querySelector('#busy .arc')).animationName"));
  await ev("document.getElementById('busy').hidden = true");

  const pdf = await send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 });
  await writeFile(join(outDir, "from-editor.pdf"), Buffer.from(pdf.result.data, "base64"));
  console.log("errors on the page:", errors.length ? errors : "none");
} finally {
  ws?.close(); chrome.kill(); server.close(); await sleep(300); await rm(profile, { recursive: true, force: true });
}
