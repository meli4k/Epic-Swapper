import { app, BrowserWindow, clipboard, ipcMain, shell } from "electron";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createService } from "../src/service.js";

const here = dirname(fileURLToPath(import.meta.url));

function appDirectory() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (app.isPackaged) return dirname(process.execPath);
  return join(here, "..");
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      return { error: error?.message || "Request failed." };
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else app.whenReady().then(() => {
  const folder = join(appDirectory(), "data");
  mkdirSync(folder, { recursive: true });
  const service = createService(join(folder, "session.json"));

  handle("desktop:state", () => service.state());
  handle("desktop:swap-start", () => {
    service.beginSwap();
    return service.state();
  });
  handle("desktop:swap-double", () => {
    service.beginDoubleSwap();
    return service.state();
  });
  handle("desktop:swap-cancel", () => {
    const stopped = service.cancelSwap();
    if (!stopped.ok) return { error: stopped.error };
    return service.state();
  });
  handle("desktop:swap-confirm", () => {
    service.confirmSwap();
    return service.state();
  });
  handle("desktop:session-start", (_event, force) => {
    service.beginSessionLogin(Boolean(force));
    return service.state();
  });
  handle("desktop:session-cancel", () => {
    service.cancelSession();
    return service.state();
  });
  handle("desktop:session-logout", async () => {
    await service.logoutSession();
    return service.state();
  });
  handle("desktop:lookup", (_event, name) => service.lookupName(name));
  handle("desktop:copy", (_event, text) => {
    clipboard.writeText(String(text || ""));
    return {};
  });

  if (process.env.GUI_TEST === "1") {
    const snapshot = service.state();
    if (snapshot.swap?.phase !== "idle") app.exit(1);
    else app.exit(0);
    return;
  }

  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    title: "Epic Swapper",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#000000", symbolColor: "#8e9097", height: 44 },
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.loadFile(join(here, "..", "public", "index.html"));

  app.on("second-instance", () => {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  app.on("window-all-closed", () => app.quit());
});
