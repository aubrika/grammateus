// The desktop program: one window showing the editing screen, with real files and menus.

const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const { pathToFileURL } = require("node:url");

// The screen is served from inside the program under app://, which lets it load its
// scripts and fonts like an ordinary web page without touching the network. The one thing
// that does use the network is the check for a newer version, further down.
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let win = null;
let currentPath = null;
let closing = false;
const isBulletin = (a) => /\.bulletin$/i.test(a);
let startFile = process.argv.slice(1).find(isBulletin) || null;
let pendingFile = null;                    // a bulletin opened from outside while the window is up

// ---------------------------------------------------------------- the log
//
// A short record of what the program did, kept beside its settings, so that if it ever
// hangs or fails on someone's computer there is something to look at afterwards.
// Help > Show the log file finds it.

const logFile = () => path.join(app.getPath("userData"), "grammateus.log");
function log(...words) {
  try {
    const file = logFile();
    if (fsSync.existsSync(file) && fsSync.statSync(file).size > 1_000_000) fsSync.renameSync(file, `${file}.old`);
    fsSync.appendFileSync(file, `${new Date().toISOString()}  ${words.join(" ")}\n`);
  } catch { /* a log that cannot be written must never stop the program */ }
}
process.on("uncaughtException", (error) => log("error in the program:", error?.stack || error));

// ---------------------------------------------------------------- one copy at a time
//
// Opening Grammateus again, or double-clicking a bulletin, while it is already running
// brings the open window forward (and offers to open that bulletin there) instead of
// starting a second copy.

const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on("second-instance", (_event, argv) => {
  log("started again while open; using the open window", argv.slice(1).join(" "));
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const file = argv.slice(1).find(isBulletin);
  if (file) offerFile(file);
});
// on a Mac, a bulletin double-clicked in the Finder arrives this way instead
app.on("open-file", (event, file) => { event.preventDefault(); if (win) offerFile(file); else startFile = file; });

function offerFile(file) {
  pendingFile = path.resolve(file);
  win.webContents.send("openfile", path.basename(pendingFile));
}

const send = (what) => win && win.webContents.send("menu", what);

function menu() {
  return Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),       // a Mac's first menu carries the program's name
    { label: "&File", submenu: [
      { label: "New", accelerator: "CmdOrCtrl+N", click: () => send("new") },
      { label: "Open…", accelerator: "CmdOrCtrl+O", click: () => send("open") },
      { label: "Import a bulletin PDF…", click: () => send("import") },
      { type: "separator" },
      { label: "Save", accelerator: "CmdOrCtrl+S", click: () => send("save") },
      { label: "Save as…", accelerator: "CmdOrCtrl+Shift+S", click: () => send("saveas") },
      { type: "separator" },
      { label: "Make PDF…", accelerator: "CmdOrCtrl+P", click: () => send("pdf") },
      { type: "separator" },
      { role: "quit" },
    ] },
    { label: "&Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" },
                                { role: "paste" }, { role: "pasteAndMatchStyle" }, { role: "selectAll" }, { type: "separator" },
                                { label: "Enlarge text to fill the sheets (experimental)", click: () => send("fit") }] },
    { label: "&View", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "&Help", submenu: [
      { label: "Check for a newer version…", click: () => checkForUpdate(true) },
      { type: "separator" },
      { label: "Show the log file", click: () => { log("log shown"); shell.showItemInFolder(logFile()); } },
      { label: "About Grammateus", click: () => dialog.showMessageBox(win, { type: "info", buttons: ["OK"], title: "About Grammateus",
          message: `Grammateus ${app.getVersion()}`, detail: "Makes a folded Sunday bulletin as a PDF ready for the printer." }) },
    ] },
  ]);
}

// ---------------------------------------------------------------- newer versions
//
// When the program starts it asks the public downloads page whether a newer version exists.
// If one does, it is fetched while the person works and installed when they close the
// program. Nothing is ever installed in the middle of work, and if the check fails (no
// internet, for example) the program simply carries on.
//
// The installing is done in plain sight: a small window shows its progress and then opens
// the new version. Installing silently looked as if nothing was happening, and opening the
// program again before it had finished made the installer close it.
//
// That is on Windows, and on Linux for the AppImage. A Mac only lets a program replace
// itself when it is signed by a paid Apple developer account, and the .deb package belongs
// to the system's package manager, so there the program only says that a newer version is
// on the downloads page and offers to open it.

const DOWNLOADS = "https://github.com/aubrika/grammateus-releases/releases/latest";
const replacesItself = process.platform === "win32" || (process.platform === "linux" && !!process.env.APPIMAGE);

let updater = null;
let updateReady = false;                   // a newer version is downloaded and waiting
let updateNote = "";                       // what the screen shows about an update, if anything
let asked = false;                         // the person chose "Check for a newer version"

function tellUpdate(text) {
  updateNote = text;
  if (win) win.webContents.send("update", text);
}

function setUpUpdates() {
  if (!app.isPackaged) return;             // only the installed program updates itself
  if (!replacesItself) { checkForUpdate(false); return; }
  try { updater = require("electron-updater").autoUpdater; } catch { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;    // done by hand when the window closes, see createWindow
  const answer = (message, detail) => { if (asked && win) dialog.showMessageBox(win, { type: "info", buttons: ["OK"], title: "Grammateus", message, detail }); asked = false; };
  for (const name of ["checking-for-update", "update-available", "update-not-available", "update-downloaded", "error"])
    updater.on(name, (info) => log("update:", name, info?.version || info?.message || ""));
  updater.on("update-available", (info) => {
    tellUpdate(`Version ${info.version} is being downloaded…`);
    answer(`Version ${info.version} is available.`, "It is being downloaded now. When it is ready, the top of the window will say so.");
  });
  updater.on("download-progress", (p) => tellUpdate(`Downloading the new version: ${Math.round(p.percent)}%`));
  updater.on("update-downloaded", (info) => {
    updateReady = true;
    tellUpdate(`Version ${info.version} is ready. It is installed when you close Grammateus, and then the new version opens.`);
  });
  updater.on("update-not-available", () => answer(`You have the newest version (${app.getVersion()}).`));
  updater.on("error", (error) => {
    if (updateNote.startsWith("Downloading") || updateNote.includes("being downloaded")) tellUpdate("The new version could not be downloaded. Grammateus will try again next time it starts.");
    answer("Grammateus could not check for a newer version.", `Check that this computer is connected to the internet, then try again.\n\n(${error?.message?.split("\n")[0] || "unknown error"})`);
  });
  checkForUpdate(false);
}

// "1.10.0" is newer than "1.9.2"
const newer = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

async function checkDownloadsPage(byHand) {
  const say = (message, detail) => byHand && win && dialog.showMessageBox(win, { type: "info", buttons: ["OK"], title: "Grammateus", message, detail });
  try {
    const reply = await net.fetch("https://api.github.com/repos/aubrika/grammateus-releases/releases/latest",
      { headers: { Accept: "application/vnd.github+json", "User-Agent": "Grammateus" } });
    if (!reply.ok) throw new Error(`the downloads page answered ${reply.status}`);
    const latest = String((await reply.json()).tag_name || "").replace(/^v/, "");
    if (latest && newer(latest, app.getVersion())) {
      tellUpdate(`Version ${latest} is available on the downloads page.`);
      say(`Version ${latest} is available.`, "Press “Open the downloads page” at the top of the window to get it.");
    } else say(`You have the newest version (${app.getVersion()}).`);
  } catch (error) {
    say("Grammateus could not check for a newer version.", `Check that this computer is connected to the internet, then try again.\n\n(${error.message})`);
  }
}

function checkForUpdate(byHand) {
  if (app.isPackaged && !replacesItself) { checkDownloadsPage(byHand); return; }
  if (!updater) {
    if (byHand) dialog.showMessageBox(win, { type: "info", buttons: ["OK"], title: "Grammateus", message: "Only the installed program can check for a newer version." });
    return;
  }
  if (byHand && updateNote.includes("is ready")) { dialog.showMessageBox(win, { type: "info", buttons: ["OK"], title: "Grammateus", message: updateNote }); return; }
  asked = byHand;
  updater.checkForUpdates().catch(() => {});       // failures arrive through the "error" event above
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 1100, minHeight: 650, title: "Grammateus",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  win.loadURL("app://local/src/app/index.html");
  win.webContents.on("did-finish-load", () => { log("window ready"); if (updateNote) win.webContents.send("update", updateNote); });
  // if the window stops answering, note it, and where the screen's code was at the time
  win.on("unresponsive", async () => {
    log("the window stopped answering");
    try { log("it was busy in:", await win.webContents.mainFrame.collectJavaScriptCallStack()); } catch (error) { log("(where it was busy is not known:", error.message, ")"); }
  });
  win.on("responsive", () => log("the window answers again"));
  win.webContents.on("render-process-gone", (_event, details) => log("the window's process ended:", details.reason, details.exitCode));
  win.webContents.on("console-message", (event, ...legacy) => {
    const level = event.level ?? legacy[0], message = event.message ?? legacy[1];
    if (level === "error" || level === 3) log("error on the screen:", message);
  });
  win.on("close", async (event) => {
    if (closing) return;
    event.preventDefault();
    const dirty = await win.webContents.executeJavaScript("window.grammateus ? window.grammateus.isDirty() : false").catch(() => false);
    if (dirty) {
      const { response } = await dialog.showMessageBox(win, {
        type: "warning", buttons: ["Go back", "Close without saving"], defaultId: 0, cancelId: 0,
        message: "This bulletin has changes that are not saved.", detail: "If you close now, those changes are lost.",
      });
      if (response === 0) return;
    }
    closing = true;
    if (updateReady && updater) {
      // show the installer's progress window, and let it open the new version when it is done
      try { updater.quitAndInstall(false, false); return; } catch { /* close as usual */ }
    }
    win.close();
  });
  win.on("closed", () => { win = null; });
}

// lets the log say where the screen's code was busy if the window stops answering
app.commandLine.appendSwitch("enable-features", "DocumentPolicyIncludeJSCallStacksInCrashReports");

app.on("child-process-gone", (_event, details) => log("a helper process ended:", details.type, details.reason, details.exitCode));

app.whenReady().then(() => {
  if (!primary) return;
  log(`started: Grammateus ${app.getVersion()} on ${process.platform} ${process.getSystemVersion()}`, process.argv.slice(1).join(" "));
  const rootDir = app.getAppPath();
  protocol.handle("app", async (request) => {
    const file = path.normalize(path.join(rootDir, decodeURIComponent(new URL(request.url).pathname)));
    if (!file.startsWith(rootDir)) return new Response("", { status: 403 });
    const reply = await net.fetch(pathToFileURL(file).toString());
    if (!file.endsWith(".html")) return reply;
    const headers = new Headers(reply.headers);
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Document-Policy", "include-js-call-stacks-in-crash-reports");
    return new Response(reply.body, { status: reply.status, headers });
  });
  // the only permission the screen needs: to list the fonts installed on this computer
  session.defaultSession.setPermissionRequestHandler((_contents, permission, allow) => allow(permission === "local-fonts"));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === "local-fonts");
  Menu.setApplicationMenu(menu());
  createWindow();
  setUpUpdates();
});

app.on("window-all-closed", () => app.quit());

// "Install now" on the screen: the same as closing the window, so unsaved work is asked about first
ipcMain.handle("install", () => { if (win) win.close(); });
ipcMain.handle("downloads", () => shell.openExternal(DOWNLOADS));

// the screen agreed to open a bulletin that came from outside (see offerFile)
ipcMain.handle("take", async () => {
  if (!pendingFile) return null;
  try {
    currentPath = pendingFile;
    return { text: await fs.readFile(currentPath, "utf8"), name: path.basename(currentPath) };
  } catch { return null; } finally { pendingFile = null; }
});

ipcMain.handle("initial", async () => {
  if (!startFile) return null;
  try {
    currentPath = path.resolve(startFile);
    return { text: await fs.readFile(currentPath, "utf8"), name: path.basename(currentPath) };
  } catch { currentPath = null; return null; }
});

ipcMain.handle("open", async () => {
  const picked = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "Bulletins", extensions: ["bulletin", "json"] }] });
  if (picked.canceled || !picked.filePaths.length) return null;
  currentPath = picked.filePaths[0];
  return { text: await fs.readFile(currentPath, "utf8"), name: path.basename(currentPath) };
});

ipcMain.handle("save", async (_event, text, asNew, suggested) => {
  let target = currentPath;
  if (asNew || !target) {
    const picked = await dialog.showSaveDialog(win, {
      defaultPath: currentPath ? path.join(path.dirname(currentPath), suggested) : suggested,
      filters: [{ name: "Bulletins", extensions: ["bulletin"] }],
    });
    if (picked.canceled || !picked.filePath) return null;
    target = picked.filePath;
  }
  // write beside the target first, so a failed save never damages the existing file
  const temp = `${target}.saving`;
  await fs.writeFile(temp, text, "utf8");
  await fs.rename(temp, target);
  currentPath = target;
  return path.basename(target);
});

ipcMain.handle("pdf", async (_event, suggested, bulletin) => {
  const picked = await dialog.showSaveDialog(win, {
    defaultPath: currentPath ? path.join(path.dirname(currentPath), suggested) : suggested,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (picked.canceled || !picked.filePath) return null;
  let data = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { marginType: "none" } });
  // keep an editable copy of the bulletin inside the PDF, so the PDF can be opened again later;
  // if that fails for any reason the plain PDF is still written
  try {
    const { embedBulletin } = await import("../src/pdf_embed.mjs");
    data = Buffer.from(await embedBulletin(data, bulletin));
  } catch { /* the PDF itself is what matters */ }
  await fs.writeFile(picked.filePath, data);
  return picked.filePath;
});
