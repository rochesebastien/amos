import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, initDatabase } from "./db/index.js";
import { registerIpcHandlers } from "./ipc.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** Set by electron-vite while running `electron-vite dev`. */
const rendererDevUrl = process.env.ELECTRON_RENDERER_URL;
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0b0b0c",
    webPreferences: {
      preload: path.join(dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Never let the app frame navigate away; external links open in the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (rendererDevUrl) {
    void win.loadURL(rendererDevUrl);
  } else {
    void win.loadFile(path.join(dirname, "../renderer/index.html"));
  }

  return win;
}

// A second launch focuses the existing window instead of opening a new one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    if (isDev) app.setAppUserModelId("com.amos.app.dev");
    else app.setAppUserModelId("com.amos.app");

    // `userData` is per-app and per-build-channel, so the dev app never
    // shares its database with an installed release.
    initDatabase(path.join(app.getPath("userData"), "amos.db"));
    registerIpcHandlers();
    mainWindow = createWindow();
    mainWindow.on("closed", () => {
      mainWindow = null;
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow();
        mainWindow.on("closed", () => {
          mainWindow = null;
        });
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("will-quit", () => closeDatabase());
}
