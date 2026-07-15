"use strict";
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const DEFAULT_DATA_DIR = app.getPath("userData");
const DATA_FILENAME = "harukyul-data.json";
const ONEDRIVE_HINT = path.join(os.homedir(), "OneDrive");

let win = null;
let tray = null;
let isQuitting = false;

/* ── Config (window state, dataDir, toggles) ── */
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    return {};
  }
}
function saveConfig(partial) {
  const cur = loadConfig();
  const next = Object.assign({}, cur, partial);
  try {
    const tmp = CONFIG_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(tmp, CONFIG_PATH);
  } catch (e) {}
  return next;
}
function getConfig() {
  const c = loadConfig();
  return Object.assign(
    {
      dataDir: DEFAULT_DATA_DIR,
      alwaysOnTop: true,
      autoStart: false,
      opacity: 1,
      bounds: { width: 380, height: 600, x: undefined, y: undefined }
    },
    c
  );
}
function dataFilePath() {
  return path.join(getConfig().dataDir, DATA_FILENAME);
}

/* ── Atomic write ── */
function atomicWrite(filePath, contents) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + ".tmp-" + Date.now();
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, filePath);
}

/* ── Window ── */
function createWindow() {
  const cfg = getConfig();
  const b = cfg.bounds || {};
  win = new BrowserWindow({
    width: b.width || 380,
    height: b.height || 600,
    x: b.x,
    y: b.y,
    minWidth: 300,
    minHeight: 360,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: !!cfg.alwaysOnTop,
    opacity: typeof cfg.opacity === "number" ? cfg.opacity : 1,
    backgroundColor: "#00000000",
    icon: trayIcon(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  const persistBounds = debounce(() => {
    if (!win || win.isDestroyed()) return;
    saveConfig({ bounds: win.getBounds() });
  }, 400);
  win.on("resize", persistBounds);
  win.on("move", persistBounds);

  win.on("close", (e) => {
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function debounce(fn, ms) {
  let t = null;
  return function () {
    clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

function trayIcon() {
  const custom = path.join(__dirname, "assets", "icon.png");
  if (fs.existsSync(custom)) return nativeImage.createFromPath(custom);
  // 1x1 transparent fallback so Tray() never throws if no custom icon is supplied.
  const FALLBACK =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  return nativeImage.createFromDataURL("data:image/png;base64," + FALLBACK).resize({ width: 16, height: 16 });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip("하루결");
  const menu = Menu.buildFromTemplate([
    {
      label: "보이기/숨기기",
      click: () => {
        if (!win) return;
        if (win.isVisible()) win.hide();
        else {
          win.show();
          win.focus();
        }
      }
    },
    { type: "separator" },
    {
      label: "종료",
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => {
    if (!win) return;
    if (win.isVisible()) win.hide();
    else {
      win.show();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // Tray app: do not quit when window is hidden/closed; only via tray "종료".
});

/* ── IPC: data ── */
ipcMain.handle("data:load", () => {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(dataFilePath(), "utf8")) };
  } catch (e) {
    return { ok: false, data: null };
  }
});

ipcMain.handle("data:save", (e, data) => {
  try {
    atomicWrite(dataFilePath(), JSON.stringify(data, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("data:importFromLocalStorage", (e, raw) => {
  // Called once on first run when no JSON file exists yet but the old
  // localStorage payload (harukyul.v2) was found in the renderer.
  try {
    if (fs.existsSync(dataFilePath())) return { ok: false, reason: "exists" };
    atomicWrite(dataFilePath(), JSON.stringify(raw, null, 2));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("data:export", async () => {
  const res = await dialog.showSaveDialog(win, {
    title: "하루결 데이터 내보내기",
    defaultPath: "harukyul-export-" + new Date().toISOString().slice(0, 10) + ".json",
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (res.canceled || !res.filePath) return { ok: false };
  try {
    const cur = fs.readFileSync(dataFilePath(), "utf8");
    fs.writeFileSync(res.filePath, cur, "utf8");
    return { ok: true, filePath: res.filePath };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("data:import", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "하루결 데이터 가져오기 (폰 PWA에서 내보낸 .json 포함)",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (res.canceled || !res.filePaths.length) return { ok: false };
  try {
    const raw = fs.readFileSync(res.filePaths[0], "utf8");
    const parsed = JSON.parse(raw);
    return { ok: true, data: parsed };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

/* ── IPC: config / window controls ── */
ipcMain.handle("config:get", () => {
  const cfg = getConfig();
  return Object.assign({}, cfg, { dataFile: dataFilePath(), oneDriveHint: ONEDRIVE_HINT });
});

ipcMain.handle("config:chooseFolder", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "데이터 저장 폴더 선택 (예: OneDrive 폴더)",
    properties: ["openDirectory", "createDirectory"]
  });
  if (res.canceled || !res.filePaths.length) return { ok: false };
  const newDir = res.filePaths[0];
  const oldFile = dataFilePath();
  saveConfig({ dataDir: newDir });
  const newFile = dataFilePath();
  try {
    if (fs.existsSync(oldFile) && !fs.existsSync(newFile)) {
      fs.copyFileSync(oldFile, newFile);
    }
  } catch (e) {}
  return { ok: true, dataDir: newDir, dataFile: newFile };
});

ipcMain.handle("window:minimize", () => {
  if (win) win.minimize();
});
ipcMain.handle("window:hide", () => {
  if (win) win.hide();
});
ipcMain.handle("window:close", () => {
  if (win) win.hide();
});
ipcMain.handle("window:toggleAlwaysOnTop", (e, value) => {
  if (!win) return { ok: false };
  win.setAlwaysOnTop(!!value);
  saveConfig({ alwaysOnTop: !!value });
  return { ok: true, value: !!value };
});
ipcMain.handle("window:setOpacity", (e, value) => {
  if (!win) return { ok: false };
  const v = Math.min(1, Math.max(0.4, Number(value) || 1));
  win.setOpacity(v);
  saveConfig({ opacity: v });
  return { ok: true, value: v };
});
ipcMain.handle("app:toggleAutoStart", (e, value) => {
  app.setLoginItemSettings({ openAtLogin: !!value, path: process.execPath });
  saveConfig({ autoStart: !!value });
  return { ok: true, value: !!value };
});
