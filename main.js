"use strict";
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, nativeImage, Notification } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { planBackupKeep, NAME_RE } = require("./backup");

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const DEFAULT_DATA_DIR = app.getPath("userData");
const DATA_FILENAME = "harukyul-data.json";
const BACKUP_DIRNAME = "harukyul-backups";
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
  // 규칙 자체는 backup.js 에 있다(테스트 가능하도록 분리).
  try {
    const dir = backupDir();
    const names = fs.readdirSync(dir);
    const keep = planBackupKeep(names, new Date());
    names.forEach((n) => {
      if (!NAME_RE.test(n)) return;
      if (!keep.has(n)) {
        try { fs.unlinkSync(path.join(dir, n)); } catch (e) {}
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
      .filter((n) => NAME_RE.test(n))
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

/* 가져올 파일이 어떤 기록인지 한 줄로 요약한다. 확인 창에 보여주기 위한 것. */
function summarize(d) {
  try {
    const days = Object.keys((d && d.days) || {}).sort();
    let tasks = 0;
    days.forEach((k) => {
      const r = d.days[k];
      if (r && r.tasks) Object.keys(r.tasks).forEach((b) => { tasks += (r.tasks[b] || []).length; });
    });
    return {
      days: days.length,
      from: days[0] || "-",
      to: days[days.length - 1] || "-",
      tasks: tasks,
      inbox: ((d && d.inbox) || []).length,
      carry: ((d && d.carry) || []).length
    };
  } catch (e) {
    return null;
  }
}
function describe(s) {
  if (!s) return "읽을 수 없음";
  return s.days + "일 (" + s.from + " ~ " + s.to + ")"
       + " · 작업 " + s.tasks + "개 · 보관함 " + s.inbox + " · 남은 업무 " + s.carry;
}

/* 덮어쓰기 직전에 지금 기록을 따로 남긴다. 되돌릴 수 있게. */
function snapshotBeforeImport() {
  const fp = dataFilePath();
  if (!fs.existsSync(fp)) return null;
  const d = new Date();
  const stamp = todayStamp() + "_" +
    String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0") +
    String(d.getSeconds()).padStart(2, "0");
  const out = path.join(getConfig().dataDir, "harukyul-before-import-" + stamp + ".json");
  fs.copyFileSync(fp, out);
  return out;
}

ipcMain.handle("data:import", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "하루결 데이터 가져오기 (폰 PWA에서 내보낸 .json 포함)",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (res.canceled || !res.filePaths.length) return { ok: false };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(res.filePaths[0], "utf8"));
  } catch (err) {
    await dialog.showMessageBox(win, {
      type: "error",
      title: "가져오기 실패",
      message: "이 파일을 읽을 수 없습니다.",
      detail: String(err)
    });
    return { ok: false, error: String(err) };
  }

  // 무엇으로 바뀌는지 보여주고 확인받는다. 이 작업은 되돌리기 어렵다.
  let current = null;
  try { current = summarize(JSON.parse(fs.readFileSync(dataFilePath(), "utf8"))); } catch (e) {}

  const ask = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["가져오기", "취소"],
    defaultId: 1,
    cancelId: 1,
    title: "데이터 가져오기",
    message: "지금 기록을 이 파일의 내용으로 바꿉니다.",
    detail:
      "가져올 파일\n  " + describe(summarize(parsed)) + "\n\n" +
      "지금 기록\n  " + (current ? describe(current) : "없음") + "\n\n" +
      "바꾸기 전에 지금 기록을 harukyul-before-import-<시각>.json 으로 저장합니다."
  });
  if (ask.response !== 0) return { ok: false, canceled: true };

  let snapshot = null;
  try {
    snapshot = snapshotBeforeImport();
  } catch (err) {
    const go = await dialog.showMessageBox(win, {
      type: "error",
      buttons: ["그래도 진행", "취소"],
      defaultId: 1,
      cancelId: 1,
      title: "지금 기록을 저장하지 못했습니다",
      message: "덮어쓰기 전 사본을 만들지 못했습니다.",
      detail: String(err) + "\n\n진행하면 지금 기록을 되돌릴 수 없습니다."
    });
    if (go.response !== 0) return { ok: false, canceled: true };
  }

  return { ok: true, data: parsed, snapshot: snapshot };
});

/* ── IPC: config / window controls ── */
ipcMain.handle("config:get", () => {
  const cfg = getConfig();
  return Object.assign({}, cfg, { dataFile: dataFilePath(), oneDriveHint: ONEDRIVE_HINT });
});

function readSummary(fp) {
  try { return summarize(JSON.parse(fs.readFileSync(fp, "utf8"))); } catch (e) { return null; }
}

ipcMain.handle("config:chooseFolder", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "데이터 저장 폴더 선택 (예: OneDrive 폴더)",
    properties: ["openDirectory", "createDirectory"]
  });
  if (res.canceled || !res.filePaths.length) return { ok: false };

  const newDir = res.filePaths[0];
  const oldFile = dataFilePath();
  const newFile = path.join(newDir, DATA_FILENAME);
  if (path.resolve(oldFile) === path.resolve(newFile)) return { ok: false, same: true };

  const hasOld = fs.existsSync(oldFile);
  const hasNew = fs.existsSync(newFile);

  // 새 폴더에 이미 기록이 있으면 어느 쪽을 쓸지 물어야 한다.
  // 묻지 않고 폴더만 바꾸면, 화면에 남아 있던 옛 기록이 다음 저장 때
  // 새 폴더의 기록을 덮어쓴다. 기기 두 대를 같은 폴더로 쓸 때 실제로 일어난다.
  if (hasOld && hasNew) {
    const a = readSummary(oldFile);
    const b = readSummary(newFile);
    const ask = await dialog.showMessageBox(win, {
      type: "question",
      buttons: ["새 폴더의 기록을 쓴다", "지금 기록으로 덮어쓴다", "취소"],
      defaultId: 0,
      cancelId: 2,
      title: "새 폴더에 이미 기록이 있어요",
      message: "어느 쪽을 이어서 쓸까요?",
      detail:
        "새 폴더\n  " + (b ? describe(b) : "읽을 수 없음") + "\n\n" +
        "지금 기록\n  " + (a ? describe(a) : "읽을 수 없음") + "\n\n" +
        "덮어쓰기를 고르면 새 폴더의 기록을 먼저 따로 저장합니다."
    });
    if (ask.response === 2) return { ok: false, canceled: true };
    if (ask.response === 1) {
      try {
        const d = new Date();
        const stamp = todayStamp() + "_" +
          String(d.getHours()).padStart(2, "0") + String(d.getMinutes()).padStart(2, "0");
        fs.copyFileSync(newFile, path.join(newDir, "harukyul-replaced-" + stamp + ".json"));
        fs.copyFileSync(oldFile, newFile);
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }
  } else if (hasOld && !hasNew) {
    try { fs.mkdirSync(newDir, { recursive: true }); fs.copyFileSync(oldFile, newFile); } catch (e) {}
  }

  saveConfig({ dataDir: newDir });
  // reload:true — 화면이 반드시 새 폴더의 파일을 다시 읽어야 한다
  return { ok: true, dataDir: newDir, dataFile: dataFilePath(), reload: true };
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
