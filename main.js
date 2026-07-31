"use strict";
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const DEFAULT_DATA_DIR = app.getPath("userData");
const DATA_FILENAME = "harukyul-data.json";
const BACKUP_DIRNAME = "harukyul-backups";
const BACKUP_DAILY_DAYS = 14;    // 최근 14일: 매일 보관
const BACKUP_WEEKLY_DAYS = 70;   // 그 이후 ~8주: 주 1개
const BACKUP_MONTHLY_DAYS = 400; // 그 이후 ~1년: 월 1개 (넘으면 삭제)
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

/* ── Rolling daily backups (데이터 유실 방지) ── */
function backupDir() {
  return path.join(getConfig().dataDir, BACKUP_DIRNAME);
}
function todayStamp() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function writeDailyBackup(contents) {
  try {
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, "harukyul-" + todayStamp() + ".json");
    const tmp = f + ".tmp-" + Date.now();
    fs.writeFileSync(tmp, contents, "utf8");
    fs.renameSync(tmp, f);
    pruneBackups();
  } catch (e) {}
}
function pruneBackups() {
  // 계단식(GFS) 솎아내기: 최근은 매일, 오래된 건 주 1개 → 월 1개만 남김.
  try {
    const dir = backupDir();
    const DAY = 86400000;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const items = fs
      .readdirSync(dir)
      .map((n) => n.match(/^harukyul-(\d{4})-(\d{2})-(\d{2})\.json$/) && n)
      .filter(Boolean)
      .map((n) => {
        const m = n.match(/^harukyul-(\d{4})-(\d{2})-(\d{2})\.json$/);
        const d = new Date(+m[1], +m[2] - 1, +m[3]); d.setHours(0, 0, 0, 0);
        return { name: n, date: d, ageDays: Math.round((today - d) / DAY) };
      })
      .sort((a, b) => b.date - a.date); // 최신 먼저

    const keep = new Set();
    const seenWeek = new Set();
    const seenMonth = new Set();
    items.forEach((it) => {
      if (it.ageDays < 0 || it.ageDays <= BACKUP_DAILY_DAYS) {
        keep.add(it.name); // 미래 날짜(시계 변경) 또는 최근 14일: 매일 보관
      } else if (it.ageDays <= BACKUP_WEEKLY_DAYS) {
        const wk = "W" + Math.floor(it.ageDays / 7);
        if (!seenWeek.has(wk)) { seenWeek.add(wk); keep.add(it.name); }
      } else if (it.ageDays <= BACKUP_MONTHLY_DAYS) {
        const mo = it.date.getFullYear() + "-" + (it.date.getMonth() + 1);
        if (!seenMonth.has(mo)) { seenMonth.add(mo); keep.add(it.name); }
      }
      // BACKUP_MONTHLY_DAYS 초과 → keep 안 함 → 삭제
    });

    items.forEach((it) => {
      if (!keep.has(it.name)) {
        try { fs.unlinkSync(path.join(dir, it.name)); } catch (e) {}
      }
    });
  } catch (e) {}
}
function latestGoodBackup() {
  try {
    const dir = backupDir();
    if (!fs.existsSync(dir)) return null;
    const files = fs
      .readdirSync(dir)
      .filter((n) => /^harukyul-\d{4}-\d{2}-\d{2}\.json$/.test(n))
      .sort();
    for (let i = files.length - 1; i >= 0; i--) {
      try {
        const raw = fs.readFileSync(path.join(dir, files[i]), "utf8");
        JSON.parse(raw);
        return { file: files[i], raw: raw };
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
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

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // 이미 한 인스턴스가 돌고 있으면 즉시 종료 (한 기기 = 하나만).
  app.quit();
} else {
  app.on("second-instance", () => {
    // 두 번째로 실행하면 새 창을 띄우지 않고 기존 창을 앞으로.
    showWindow();
  });
  app.whenReady().then(() => {
    app.setAppUserModelId("com.personal.harukyul"); // Windows 알림 표시에 필요
    createWindow();
    createTray();
  });
}

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // Tray app: do not quit when window is hidden/closed; only via tray "종료".
});

/* ── IPC: data ── */
ipcMain.handle("data:load", () => {
  const fp = dataFilePath();
  if (!fs.existsSync(fp)) {
    // 데이터 파일이 아예 없음 = 진짜 첫 실행. 빈 상태로 시작해도 안전.
    return { ok: true, data: null, fresh: true };
  }
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(fp, "utf8")) };
  } catch (e) {
    // 파일은 있는데 못 읽음(잠김/손상/동기화 충돌). 원본 보존 후 최신 백업으로 복구 시도.
    try { fs.copyFileSync(fp, fp + ".corrupt-" + Date.now()); } catch (e2) {}
    const bak = latestGoodBackup();
    if (bak) {
      try {
        return { ok: true, data: JSON.parse(bak.raw), recovered: bak.file };
      } catch (e3) {}
    }
    // 못 읽고 백업도 없음: 손상본은 이미 .corrupt로 보존됨을 알림.
    return { ok: false, error: String(e), fileExists: true };
  }
});

ipcMain.handle("data:save", (e, data) => {
  try {
    const contents = JSON.stringify(data, null, 2);
    atomicWrite(dataFilePath(), contents);
    writeDailyBackup(contents);
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

ipcMain.handle("notify", (e, payload) => {
  try {
    if (!Notification.isSupported()) return { ok: false, reason: "unsupported" };
    const n = new Notification({
      title: (payload && payload.title) || "하루결",
      body: (payload && payload.body) || ""
    });
    n.on("click", showWindow);
    n.show();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});
