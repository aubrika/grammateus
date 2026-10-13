// The desktop program: one window showing the editing screen, with real files and menus.

const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { pathToFileURL } = require("node:url");

// The screen is served from inside the program under app://, which lets it load its
// scripts and fonts like an ordinary web page without touching the network.
protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let win = null;
let currentPath = null;
let closing = false;
const startFile = process.argv.slice(1).find((a) => /\.bulletin$/i.test(a)) || null;

const send = (what) => win && win.webContents.send("menu", what);

function menu() {
  return Menu.buildFromTemplate([
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
                                { role: "paste" }, { role: "pasteAndMatchStyle" }, { role: "selectAll" }] },
    { label: "&View", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" }] },
  ]);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 1100, minHeight: 650, title: "Grammateus",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true },
  });
  win.loadURL("app://local/src/app/index.html");
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
    win.close();
  });
  win.on("closed", () => { win = null; });
}

app.whenReady().then(() => {
  const rootDir = app.getAppPath();
  protocol.handle("app", (request) => {
    const file = path.normalize(path.join(rootDir, decodeURIComponent(new URL(request.url).pathname)));
    if (!file.startsWith(rootDir)) return new Response("", { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // the only permission the screen needs: to list the fonts installed on this computer
  session.defaultSession.setPermissionRequestHandler((_contents, permission, allow) => allow(permission === "local-fonts"));
  session.defaultSession.setPermissionCheckHandler((_contents, permission) => permission === "local-fonts");
  Menu.setApplicationMenu(menu());
  createWindow();
});

app.on("window-all-closed", () => app.quit());

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
