"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  loadData: () => ipcRenderer.invoke("data:load"),
  saveData: (data) => ipcRenderer.invoke("data:save", data),
  importFromLocalStorage: (raw) => ipcRenderer.invoke("data:importFromLocalStorage", raw),
  exportData: () => ipcRenderer.invoke("data:export"),
  importData: () => ipcRenderer.invoke("data:import"),

  getConfig: () => ipcRenderer.invoke("config:get"),
  chooseFolder: () => ipcRenderer.invoke("config:chooseFolder"),

  minimize: () => ipcRenderer.invoke("window:minimize"),
  hide: () => ipcRenderer.invoke("window:hide"),
  closeToTray: () => ipcRenderer.invoke("window:close"),
  toggleAlwaysOnTop: (v) => ipcRenderer.invoke("window:toggleAlwaysOnTop", v),
  setOpacity: (v) => ipcRenderer.invoke("window:setOpacity", v),
  toggleAutoStart: (v) => ipcRenderer.invoke("app:toggleAutoStart", v)
});
