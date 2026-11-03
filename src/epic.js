/**
 * Epic sign-in, display-name changes, and public account profiles.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import https from "node:https";
import { dirname, join } from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const SESSION_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "session.json");

const ACCOUNT = "https://account-public-service-prod.ol.epicgames.com";
const FORTNITE = "https://fortnite-public-service-prod11.ol.epicgames.com";
const ACCOUNT_HOST = "account-public-service-prod.ol.epicgames.com";
const keepAlive = new https.Agent({
  keepAlive: true,
  maxSockets: 8,
  maxFreeSockets: 8,
  keepAliveMsecs: 60_000,
});
const DEVICE_URLS = [
  "https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/deviceAuthorization",
  `${ACCOUNT}/account/api/oauth/deviceAuthorization`,
];
const ID_API = "https://www.epicgames.com/id/api";
const UA = "EpicGamesLauncher/18.0.0-36116102+++Portal+Release-Live";
const GAP_MS = 500;

function bodyBuffer(body) {
  if (body == null) return null;
  if (typeof body === "string") return Buffer.from(body);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  return Buffer.from(String(body));
}

function epicFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = bodyBuffer(options.body);
    const headers = { ...(options.headers || {}) };
    if (payload) headers["Content-Length"] = String(payload.length);
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method: options.method || "GET",
        headers,
        agent: keepAlive,
        timeout: 25000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          const status = res.statusCode || 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            headers: {
              getSetCookie() {
                const set = res.headers["set-cookie"];
                if (!set) return [];
                return Array.isArray(set) ? set : [set];
              },
            },
            text: async () => raw.toString("utf8"),
          });
        });
      }
    );
    req.setNoDelay(true);
    req.on("timeout", () => req.destroy(new Error("Could not reach Epic.")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const SWITCH_ID = "98f7e42c2e3a4f86a74eb43fbb41ed39";
const SWITCH_SECRET = "0a2449a2-001a-451e-afec-3e812901c4d7";
const ANDROID_ID = "3f69e56c7649492c8cc29f1af08a8a12";
const ANDROID_SECRET = "b51ee9cb12234f50a69efa67ef53812e";
const LAUNCHER_ID = "34a02cf8f4414e29b15921876da36f9a";
const LAUNCHER_SECRET = "daafbccc737745039dffe53d94fc76cf";
const FORTNITE_ID = "ec684b8c687f479fadea3cb2ad83f5c6";
const FORTNITE_SECRET = "e1f31c211f28413186262d37a13fc84d";

function basic(id, secret) {
  return Buffer.from(`${id}:${secret}`).toString("base64");
}

const SWITCH_BASIC = basic(SWITCH_ID, SWITCH_SECRET);
const ANDROID_BASIC = basic(ANDROID_ID, ANDROID_SECRET);
const LAUNCHER_BASIC = basic(LAUNCHER_ID, LAUNCHER_SECRET);
const FORTNITE_BASIC = basic(FORTNITE_ID, FORTNITE_SECRET);
const ACCOUNT_HOSTS = [
  "https://account-public-service-prod03.ol.epicgames.com",
  ACCOUNT,
];

function basicFor(client) {
  if (client === "android") return ANDROID_BASIC;
  if (client === "launcher") return LAUNCHER_BASIC;
  if (client === "fortnite") return FORTNITE_BASIC;
  return SWITCH_BASIC;
}

async function pause(ms, shouldStop = () => false) {
  const step = 250;
  let left = ms;
  while (left > 0) {
    if (shouldStop()) throw new Error("Sign-in cancelled.");
    const slice = Math.min(step, left);
    await new Promise((resolve) => setTimeout(resolve, slice));
    left -= slice;
  }
  if (shouldStop()) throw new Error("Sign-in cancelled.");
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 200);
}

function cloudflareLimited(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("error code:") || text.includes("<html") || text.includes("cf_challenge") || text.includes("you are being rate limited");
}

const PLATFORM_NAMES = {
  psn: "PlayStation",
  xbl: "Xbox",
  nintendo: "Nintendo",
  nintendoswitch: "Nintendo",
  switch: "Nintendo",
  steam: "Steam",
  steamopenid: "Steam",
  github: "GitHub",
  twitch: "Twitch",
  google: "Google",
  apple: "Apple",
  facebook: "Facebook",
  discord: "Discord",
  lego: "LEGO",
  vk: "VK",
};

function platformName(type) {
  const key = String(type || "").toLowerCase().replace(/[\s_-]+/g, "");
  if (!key) return "Linked account";
  return PLATFORM_NAMES[key] || String(type || "").trim() || "Linked account";
}

function accountIdFrom(value) {
  const raw = String(value || "").trim();
  const compact = raw.replace(/-/g, "");
  if (raw.length !== 32 && raw.length !== 36) return "";
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) return "";
  return compact.toLowerCase();
}

function authEntries(value) {
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
  if (!value || typeof value !== "object") return [];
  const entries = [];
  for (const [key, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const typed = entry.type || entry.externalAuthType || entry.identityProviderId;
    if (typed || entry.externalAuthId || entry.externalDisplayName || entry.authIds) {
      entries.push(typed ? entry : { ...entry, type: key });
    }
  }
  return entries;
}

function readLinked(value) {
  const linked = [];
  for (const entry of authEntries(value)) {
    const ids = [];
    const mainId = String(entry.externalAuthId || "").trim();
    if (mainId) ids.push({ type: String(entry.externalAuthIdType || "id"), id: mainId });
    if (Array.isArray(entry.authIds)) {
      for (const authId of entry.authIds) {
        const id = String(typeof authId === "string" ? authId : (authId?.id || authId?.authId || "")).trim();
        if (!id || ids.some((item) => item.id === id)) continue;
        ids.push({ type: String(authId?.type || "id"), id });
      }
    }
    const type = String(entry.type || entry.externalAuthType || entry.identityProviderId || "").trim();
    const name = String(entry.externalDisplayName || "").trim();
    if (!type && !name && !ids.length) continue;
    linked.push({
      platform: platformName(type),
      name,
      ids,
      linkedAt: String(entry.dateAdded || entry.dateLinked || "").trim(),
      region: String(entry.regionInfo || entry.region || "").trim(),
    });
  }
  return linked;
}

function linkedScore(entry) {
  return (entry.name ? 2 : 0) + (entry.ids?.length || 0) + (entry.linkedAt ? 1 : 0);
}

function mergeLinked(current, extra) {
  const map = new Map();
  for (const entry of [...current, ...extra]) {
    if (!entry || (!entry.platform && !entry.name && !(entry.ids || []).length)) continue;
    const key = `${entry.platform}|${(entry.ids || []).map((item) => item.id).sort().join("|") || entry.name}`;
    const previous = map.get(key);
    map.set(key, previous && linkedScore(previous) >= linkedScore(entry) ? previous : entry);
  }
  return [...map.values()];
}

function linkedFromPayload(data) {
  if (!data) return [];
  if (Array.isArray(data)) return mergeLinked([], data.flatMap((item) => linkedFromPayload(item)));
  if (typeof data !== "object") return [];
  if (data.externalAuths) return readLinked(data.externalAuths);
  if (data.type || data.externalAuthType || data.externalAuthId || data.externalDisplayName) return readLinked([data]);
  if (data.errorCode || data.errorMessage) return [];
  return readLinked(data);
}

function accountRecord(data) {
  const list = Array.isArray(data) ? data : [data];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (item.type || item.externalAuthType) continue;
    const id = String(item.id || "");
    if (/^[0-9a-f]{32}$/i.test(id) && (item.displayName || item.externalAuths || "links" in item || "country" in item)) {
      return item;
    }
  }
  return null;
}

function readLinks(value) {
  if (!value || typeof value !== "object") return [];
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index + 1), item]) : Object.entries(value);
  const links = [];
  for (const [key, item] of entries) {
    if (typeof item === "string" && item.trim()) {
      links.push({ label: platformName(key), url: item.trim() });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const url = String(item.url || item.href || item.link || "").trim();
    const name = String(item.displayName || item.externalDisplayName || item.name || "").trim();
    if (!url && !name) continue;
    links.push({ label: platformName(item.type || key), url, name });
  }
  return links;
}

function writeHttp(socket, { method, path, token, body, onStatus }) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(body);
    const lines = [
      `${method} ${path} HTTP/1.1`,
      `Host: ${ACCOUNT_HOST}`,
      `Authorization: bearer ${token}`,
      "Accept: application/json",
      `User-Agent: ${UA}`,
      "Connection: keep-alive",
    ];
    if (payload) {
      lines.push("Content-Type: application/json", `Content-Length: ${payload.length}`);
    }
    let buffer = Buffer.alloc(0);
    let parsed = false;
    let settled = false;
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const split = buffer.indexOf("\r\n\r\n");
      if (!parsed) {
        if (split === -1) return;
        parsed = true;
        const headerText = buffer.slice(0, split).toString("utf8");
        const status = Number(headerText.split("\r\n")[0].split(" ")[1] || 0);
        if (onStatus) onStatus(status);
      }
      if (split === -1) return;
      const headerText = buffer.slice(0, split).toString("utf8");
      const lenMatch = headerText.match(/content-length:\s*(\d+)/i);
      const length = lenMatch ? Number(lenMatch[1]) : 0;
      if (buffer.length < split + 4 + length) return;
      const raw = buffer.slice(split + 4, split + 4 + length).toString("utf8");
      let payload = {};
      if (raw) {
        try {
          const parsedBody = JSON.parse(raw);
          if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)) payload = parsedBody;
        } catch {
          payload = { errorMessage: raw.slice(0, 200) };
        }
      }
      const status = Number(headerText.split("\r\n")[0].split(" ")[1] || 0);
      finish({
        ok: status >= 200 && status < 300,
        status,
        displayName: payload.displayName || "",
        message: clean(payload.errorMessage || payload.message),
        code: String(payload.errorCode || ""),
      });
    };
    socket.on("data", onData);
    socket.on("error", onError);
    socket.write(Buffer.concat([Buffer.from(`${lines.join("\r\n")}\r\n\r\n`), payload || Buffer.alloc(0)]));
  });
}

function httpPacket({ method, path, token, body }) {
  const payload = body == null ? null : Buffer.from(body);
  const lines = [
    `${method} ${path} HTTP/1.1`,
    `Host: ${ACCOUNT_HOST}`,
    `Authorization: bearer ${token}`,
    "Accept: application/json",
    `User-Agent: ${UA}`,
    "Connection: keep-alive",
  ];
  if (payload) lines.push("Content-Type: application/json", `Content-Length: ${payload.length}`);
  return Buffer.concat([Buffer.from(`${lines.join("\r\n")}\r\n\r\n`), payload || Buffer.alloc(0)]);
}

function readHttpMessage(buffer) {
  const split = buffer.indexOf("\r\n\r\n");
  if (split === -1) return null;
  const headerText = buffer.slice(0, split).toString("utf8");
  const lenMatch = headerText.match(/content-length:\s*(\d+)/i);
  const length = lenMatch ? Number(lenMatch[1]) : 0;
  if (buffer.length < split + 4 + length) return null;
  const raw = buffer.slice(split + 4, split + 4 + length).toString("utf8");
  let payload = {};
  if (raw) {
    try {
      const parsedBody = JSON.parse(raw);
      if (parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)) payload = parsedBody;
    } catch {
      payload = { errorMessage: raw.slice(0, 200) };
    }
  }
  const status = Number(headerText.split("\r\n")[0].split(" ")[1] || 0);
  return {
    rest: buffer.slice(split + 4 + length),
    message: {
      ok: status >= 200 && status < 300,
      status,
      displayName: payload.displayName || "",
      message: clean(payload.errorMessage || payload.message),
      code: String(payload.errorCode || ""),
      doneAt: process.hrtime.bigint(),
    },
  };
}

function writeHttpMany(socket, requests) {
  return new Promise((resolve, reject) => {
    const results = [];
    let buffer = Buffer.alloc(0);
    let settled = false;
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const timer = setTimeout(() => {
      if (results.length) finish();
      else onError(new Error("Could not reach Epic."));
    }, 8000);
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(results);
    };
    const onError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (results.length < requests.length) {
        const parsed = readHttpMessage(buffer);
        if (!parsed) return;
        buffer = parsed.rest;
        results.push(parsed.message);
      }
      finish();
    };
    socket.on("data", onData);
    socket.on("error", onError);
    socket.write(Buffer.concat(requests.map((request) => httpPacket(request))));
  });
}

function openFastLane(token) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: ACCOUNT_HOST, port: 443, servername: ACCOUNT_HOST });
    socket.setNoDelay(true);
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.once("error", fail);
    socket.once("secureConnect", () => {
      socket.off("error", fail);
      const started = process.hrtime.bigint();
      writeHttp(socket, { method: "GET", path: "/account/api/oauth/verify", token })
        .then(() => resolve({ socket, rtt: Number(process.hrtime.bigint() - started) / 1e6, busy: false }))
        .catch(fail);
    });
  });
}

function closeLanes(lanes) {
  for (const lane of lanes) lane.socket.destroy();
}

function waitUntil(target) {
  return new Promise((resolve) => {
    const tick = () => {
      const left = Number(target - process.hrtime.bigint()) / 1e6;
      if (left <= 0) resolve();
      else if (left > 4) setTimeout(tick, Math.max(1, left - 3));
      else setImmediate(tick);
    };
    tick();
  });
}

function createPump(socket) {
  const waiters = [];
  let buffer = Buffer.alloc(0);
  let failed = null;
  let closed = false;
  const failWaiters = (error) => {
    if (failed) return;
    failed = error;
    while (waiters.length) waiters.shift().reject(error);
  };
  const drain = () => {
    while (waiters.length) {
      const parsed = readHttpMessage(buffer);
      if (!parsed) return;
      buffer = parsed.rest;
      waiters.shift().resolve(parsed.message);
    }
  };
  const onData = (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    drain();
  };
  const timer = setTimeout(() => failWaiters(new Error("Could not reach Epic.")), 8000);
  socket.on("data", onData);
  socket.on("error", failWaiters);
  return {
    inflight: 0,
    holdoff: 0n,
    send(request) {
      const promise = new Promise((resolve, reject) => {
        if (failed) reject(failed);
        else waiters.push({ resolve, reject });
      });
      socket.write(httpPacket(request));
      drain();
      return promise;
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", failWaiters);
      failWaiters(new Error("Could not reach Epic."));
    },
  };
}

function isTakenResult(result) {
  const text = `${result?.code || ""} ${result?.message || ""}`.toLowerCase();
  return result?.status === 409 || text.includes("duplicate") || text.includes("already") || text.includes("in use");
}

function friendlyRule(message) {
  let text = clean(message).replaceAll("displayName", "Display name");
  if (text && text[0] === text[0].toLowerCase()) text = text[0].toUpperCase() + text.slice(1);
  return text;
}

export function localIssue(name) {
  if (!name) return "Enter a display name.";
  if (name.includes("@") || name.includes(":")) {
    return "Enter a display name. This does not check emails or passwords.";
  }
  if (name.length > 32) return "That is longer than an Epic display name.";
  if ([...name].some((char) => char.charCodeAt(0) < 32)) {
    return "That name contains characters Epic will not accept.";
  }
  return "";
}

export function classifyValidation(status, payload, queried) {
  const data = payload && typeof payload === "object" ? payload : {};
  const code = String(data.errorCode || data.error || "").toLowerCase();
  const message = clean(data.message || data.errorMessage || data.error_description);

  if (status === 200 || status === 204) {
    return {
      name: queried,
      status: "available",
      detail: "Epic says this display name is available.",
    };
  }
  if (status === 409 || code.includes("duplicate_display_name") || message.toLowerCase().includes("not available")) {
    return {
      name: queried,
      status: "taken",
      detail: "Epic says this display name is not available.",
    };
  }
  if (status === 429 || code.includes("throttl") || cloudflareLimited(message)) {
    return {
      name: queried,
      status: "error",
      detail: "Epic rate limited the check. Wait a moment and try again.",
    };
  }
  if (code.includes("csrf") || message.toLowerCase().includes("authorization is invalid")) {
    return {
      name: queried,
      status: "error",
      detail: "The Epic sign-in needs to be refreshed.",
    };
  }
  if (status === 400 || status === 422 || code.includes("validation") || code.includes("invalid")) {
    return {
      name: queried,
      status: "invalid",
      detail: friendlyRule(message) || "Epic rejected this display name.",
    };
  }
  return {
    name: queried,
    status: "error",
    detail: message || `Unexpected response (${status}).`,
  };
}

class CookieJar {
  constructor() {
    this.map = new Map();
  }

  store(response) {
    const lines = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
    for (const line of lines) {
      const pair = line.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) this.map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  header() {
    return [...this.map].map(([key, value]) => `${key}=${value}`).join("; ");
  }

  get(name) {
    return this.map.get(name) || "";
  }
}

async function readJson(response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    const payload = JSON.parse(raw);
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  } catch {
    return { errorMessage: raw.slice(0, 200) };
  }
}

export class EpicClient {
  constructor(sessionPath = SESSION_PATH, options = {}) {
    this.sessionPath = sessionPath;
    this.persist = options.persist !== false && Boolean(sessionPath);
    this.rememberDevice = options.rememberDevice !== false;
    this.session = null;
    this.clientToken = "";
    this.clientExpires = 0;
    this.launcherAccess = "";
    this.launcherExpires = 0;
    this.gameAccess = "";
    this.gameExpires = 0;
    this.gamePending = null;
    this.jar = new CookieJar();
    this.portalReady = false;
    this.nextSlot = 0;
    this.load();
  }

  load() {
    if (!this.persist || !existsSync(this.sessionPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.sessionPath, "utf8"));
      if (data && (data.secret || data.access_token)) this.session = data;
    } catch {
      /* ignore a broken session file */
    }
  }

  save() {
    if (!this.persist) return;
    if (!this.session) {
      if (existsSync(this.sessionPath)) unlinkSync(this.sessionPath);
      return;
    }
    const temp = `${this.sessionPath}.tmp`;
    writeFileSync(temp, JSON.stringify(this.session, null, 2));
    writeFileSync(this.sessionPath, readFileSync(temp));
    unlinkSync(temp);
  }

  signedIn() {
    return Boolean(this.session && (this.session.secret || this.session.access_token));
  }

  displayName() {
    return this.session?.display_name || "";
  }

  accountId() {
    return this.session?.account_id || "";
  }

  async tokenRequest(fields, client = "switch") {
    const response = await epicFetch(`${ACCOUNT}/account/api/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `basic ${basicFor(client)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": UA,
      },
      body: new URLSearchParams(fields),
    });
    return { status: response.status, payload: await readJson(response) };
  }

  async clientCredentials() {
    if (this.clientToken && Date.now() < this.clientExpires - 60_000) return this.clientToken;
    const { status, payload } = await this.tokenRequest({ grant_type: "client_credentials" });
    if (status !== 200 || !payload.access_token) {
      throw new Error(clean(payload.errorMessage) || "Epic did not start a sign-in session.");
    }
    this.clientToken = payload.access_token;
    this.clientExpires = Date.now() + Number(payload.expires_in || 300) * 1000;
    return this.clientToken;
  }

  storeToken(payload, client) {
    const saved = { ...(this.session || {}) };
    saved.access_token = payload.access_token;
    saved.expires_at = Date.now() / 1000 + Number(payload.expires_in || 3600);
    if (client) saved.client = client;
    if (payload.account_id) saved.account_id = payload.account_id;
    if (payload.displayName) saved.display_name = payload.displayName;
    if (!saved.secret && payload.refresh_token) {
      saved.refresh_token = payload.refresh_token;
      saved.refresh_expires_at = Date.now() / 1000 + Number(payload.refresh_expires || 0);
    }
    this.session = saved;
    this.save();
  }

  async ensureToken(force = false) {
    const saved = this.session;
    if (!saved) throw new Error("Sign in first.");
    const token = saved.access_token || "";
    const expiresAt = Number(saved.expires_at || 0);
    if (token && !force && Date.now() / 1000 < expiresAt - 90) return token;

    const client = saved.client || "android";
    if (saved.account_id && saved.device_id && saved.secret) {
      const { status, payload } = await this.tokenRequest({
        grant_type: "device_auth",
        account_id: saved.account_id,
        device_id: saved.device_id,
        secret: saved.secret,
        token_type: "eg1",
      }, "android");
      if (status === 200 && payload.access_token) {
        this.storeToken(payload, "android");
        return payload.access_token;
      }
      if (status === 400 || status === 401 || status === 403) {
        this.session = null;
        this.save();
        throw new Error("Epic rejected the saved sign-in. Sign in again.");
      }
      throw new Error(clean(payload.errorMessage) || "Could not refresh the Epic sign-in.");
    }

    const refresh = saved.refresh_token || "";
    if (refresh && Date.now() / 1000 < Number(saved.refresh_expires_at || 0) - 30) {
      const { status, payload } = await this.tokenRequest({
        grant_type: "refresh_token",
        refresh_token: refresh,
        token_type: "eg1",
      }, client);
      if (status === 200 && payload.access_token) {
        this.storeToken(payload, client);
        return payload.access_token;
      }
    }

    if (token && Date.now() / 1000 < expiresAt - 5) return token;
    throw new Error("This sign-in expired. Sign in again.");
  }

  async portalRequest(method, url, body, bearer = "") {
    const headers = {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en",
    };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const cookie = this.jar.header();
    if (cookie) headers.Cookie = cookie;
    if (body != null) {
      headers["Content-Type"] = "application/json";
      headers.Origin = "https://www.epicgames.com";
      headers.Referer = "https://www.epicgames.com/account/personal";
      const xsrf = this.jar.get("XSRF-TOKEN");
      if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;
    }
    const response = await epicFetch(url, { method, headers, body });
    this.jar.store(response);
    return { status: response.status, payload: await readJson(response) };
  }

  async ensurePortal(force = false) {
    if (this.portalReady && !force) return;
    this.jar = new CookieJar();
    const csrf = await this.portalRequest("GET", `${ID_API}/csrf`);
    if (![200, 204].includes(csrf.status) || !this.jar.get("XSRF-TOKEN")) {
      throw new Error("Epic did not start an availability session.");
    }
    const bearer = await this.ensureToken(force);
    const exchangeResponse = await epicFetch(`${ACCOUNT}/account/api/oauth/exchange`, {
      headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json", "User-Agent": UA },
    });
    const exchange = await readJson(exchangeResponse);
    if (!exchangeResponse.ok || !exchange.code) {
      throw new Error(clean(exchange.errorMessage) || "Epic did not allow an availability check.");
    }
    const traded = await this.portalRequest(
      "POST",
      `${ID_API}/exchange`,
      JSON.stringify({ exchangeCode: exchange.code })
    );
    if (traded.status !== 200) {
      throw new Error(clean(traded.payload.message || traded.payload.errorMessage) || "Epic did not allow an availability check.");
    }
    this.portalReady = true;
  }

  async waitTurn() {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + GAP_MS;
    const delay = slot - now;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  }

  needsPortalRefresh(status, payload) {
    const message = clean(payload.message || payload.errorMessage).toLowerCase();
    const code = String(payload.errorCode || payload.error || "").toLowerCase();
    return code.includes("csrf") || message.includes("authorization is invalid") || status === 401 || status === 403;
  }

  async checkName(name) {
    const queried = String(name || "").trim();
    const issue = localIssue(queried);
    if (issue) return { name: queried, status: "invalid", detail: issue };

    await this.ensurePortal();
    const body = JSON.stringify({ displayName: queried });
    let status = 0;
    let payload = {};
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.waitTurn();
      ({ status, payload } = await this.portalRequest(
        "POST",
        `${ID_API}/account/displayName/validate`,
        body
      ));
      const rawMessage = payload.message || payload.errorMessage || "";
      if (cloudflareLimited(rawMessage)) {
        return classifyValidation(status, payload, queried);
      }
      if (this.needsPortalRefresh(status, payload) && attempt === 0) {
        this.portalReady = false;
        await this.ensurePortal(true);
        continue;
      }
      if (status === 429 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      return classifyValidation(status, payload, queried);
    }
    return classifyValidation(status, payload, queried);
  }

  async startDeviceLogin(onCode, shouldStop = () => false) {
    const clientToken = await this.clientCredentials();
    let payload = {};
    let status = 0;
    for (const url of DEVICE_URLS) {
      const response = await epicFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clientToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": UA,
        },
        body: "prompt=login",
      });
      status = response.status;
      payload = await readJson(response);
      if (status === 200 && payload.device_code) break;
    }
    if (status !== 200 || !payload.device_code) {
      throw new Error(clean(payload.errorMessage) || "Epic did not return a sign-in code.");
    }

    const interval = Math.max(5, Number(payload.interval || 5));
    const deadline = Date.now() + Number(payload.expires_in || 600) * 1000;
    onCode({
      userCode: payload.user_code || "",
      url: payload.verification_uri_complete || payload.verification_uri || "https://www.epicgames.com/activate",
    });

    while (Date.now() < deadline) {
      if (shouldStop()) throw new Error("Sign-in cancelled.");
      const polled = await this.tokenRequest({
        grant_type: "device_code",
        device_code: payload.device_code,
        token_type: "eg1",
      });
      const code = String(polled.payload.errorCode || polled.payload.error || "").toLowerCase();
      if (polled.status === 200 && polled.payload.access_token) {
        await this.finishLogin(polled.payload);
        return this.displayName();
      }
      if (code.includes("authorization_pending")) {
        await pause(interval * 1000, shouldStop);
        continue;
      }
      if (code.includes("slow_down")) {
        await pause((interval + 5) * 1000, shouldStop);
        continue;
      }
      if (code.includes("corrective_action")) {
        throw new Error("Epic needs you to finish account setup on epicgames.com, then sign in again.");
      }
      throw new Error(clean(polled.payload.errorMessage || polled.payload.error_description) || "Sign-in failed.");
    }
    throw new Error("That sign-in code expired. Start again.");
  }

  async finishLogin(payload) {
    const exchange = await epicFetch(`${ACCOUNT}/account/api/oauth/exchange`, {
      headers: {
        Authorization: `Bearer ${payload.access_token}`,
        Accept: "application/json",
        "User-Agent": UA,
      },
    });
    const exchanged = await readJson(exchange);
    if (exchange.ok && exchanged.code) {
      const { status, payload: android } = await this.tokenRequest({
        grant_type: "exchange_code",
        exchange_code: exchanged.code,
        token_type: "eg1",
      }, "android");
      if (status === 200 && android.access_token) {
        this.storeToken(android, "android");
        if (this.rememberDevice) await this.createDeviceAuth(android.access_token);
        return;
      }
    }
    this.storeToken(payload, "switch");
  }

  async createDeviceAuth(accessToken) {
    const accountId = this.session?.account_id;
    if (!accountId) return;
    const response = await epicFetch(
      `${ACCOUNT}/account/api/public/account/${encodeURIComponent(accountId)}/deviceAuth`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": UA,
        },
        body: "{}",
      }
    );
    const payload = await readJson(response);
    if (!response.ok || !payload.deviceId || !payload.secret) return;
    this.session = {
      ...this.session,
      device_id: payload.deviceId,
      secret: payload.secret,
      client: "android",
      account_id: payload.accountId || accountId,
    };
    delete this.session.refresh_token;
    delete this.session.refresh_expires_at;
    this.save();
  }

  async launcherAccessToken() {
    if (this.launcherAccess && Date.now() < this.launcherExpires - 60_000) return this.launcherAccess;
    const bearer = await this.ensureToken();
    const exchangeResponse = await epicFetch(`${ACCOUNT}/account/api/oauth/exchange`, {
      headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json", "User-Agent": UA },
    });
    const exchange = await readJson(exchangeResponse);
    if (!exchangeResponse.ok || !exchange.code) {
      throw new Error(clean(exchange.errorMessage) || "Epic did not allow a display name change.");
    }
    const { status, payload } = await this.tokenRequest({
      grant_type: "exchange_code",
      exchange_code: exchange.code,
      token_type: "eg1",
    }, "launcher");
    if (status !== 200 || !payload.access_token) {
      throw new Error(clean(payload.errorMessage) || "Epic did not allow a display name change.");
    }
    this.launcherAccess = payload.access_token;
    this.launcherExpires = Date.now() + Number(payload.expires_in || 7200) * 1000;
    if (this.session && payload.displayName) this.session.display_name = payload.displayName;
    if (this.session && payload.account_id) this.session.account_id = payload.account_id;
    this.save();
    return this.launcherAccess;
  }

  async gameAccessToken() {
    if (this.gameAccess && Date.now() < this.gameExpires - 60_000) return this.gameAccess;
    if (!this.gamePending) {
      this.gamePending = this.createGameAccess().finally(() => {
        this.gamePending = null;
      });
    }
    return this.gamePending;
  }

  async createGameAccess() {
    const bearer = await this.ensureToken();
    const exchangeResponse = await epicFetch(`${ACCOUNT}/account/api/oauth/exchange`, {
      headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json", "User-Agent": UA },
    });
    const exchange = await readJson(exchangeResponse);
    if (!exchangeResponse.ok || !exchange.code) {
      throw new Error(clean(exchange.errorMessage) || "Epic did not allow a profile lookup.");
    }
    const { status, payload } = await this.tokenRequest({
      grant_type: "exchange_code",
      exchange_code: exchange.code,
      token_type: "eg1",
    }, "fortnite");
    if (status !== 200 || !payload.access_token) {
      throw new Error(clean(payload.errorMessage) || "Epic did not allow a profile lookup.");
    }
    this.gameAccess = payload.access_token;
    this.gameExpires = Date.now() + Number(payload.expires_in || 7200) * 1000;
    return this.gameAccess;
  }

  async readEpic(url, token) {
    try {
      const response = await epicFetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "User-Agent": UA,
        },
      });
      const raw = await response.text();
      let data = null;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = null;
        }
      }
      return { status: response.status, data };
    } catch {
      return { status: 0, data: null };
    }
  }

  profileUrls(accountId) {
    const urls = [];
    for (const host of ACCOUNT_HOSTS) {
      urls.push(`${host}/account/api/public/account?accountId=${encodeURIComponent(accountId)}`);
      urls.push(`${host}/account/api/public/account/${encodeURIComponent(accountId)}/externalAuths`);
      urls.push(`${host}/account/api/public/account/${encodeURIComponent(accountId)}`);
    }
    return urls;
  }

  async collectAccount(token, urls, state) {
    for (const url of urls) {
      const result = await this.readEpic(url, token);
      if (result.status) state.reached = true;
      if (result.status === 429) throw new Error("Epic rate limited the lookup. Wait a moment and try again.");
      const code = String(result.data?.errorCode || "");
      if (result.status === 404 || code.includes("not_found")) state.miss = true;
      else if (result.status === 401 || result.status === 403) {
        state.denied = true;
        state.failure = clean(result.data?.errorMessage || result.data?.message) || state.failure;
      }
      if (!result.data) continue;
      const found = accountRecord(result.data);
      if (found && !state.record) state.record = found;
      state.linked = mergeLinked(state.linked, linkedFromPayload(result.data));
      if (found?.links) {
        const links = readLinks(found.links);
        if (links.length) state.links = links;
      }
    }
  }

  async warmAccountSocket(token) {
    await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: ACCOUNT_HOST,
          path: "/account/api/oauth/verify",
          method: "GET",
          agent: keepAlive,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            Connection: "keep-alive",
            "User-Agent": UA,
          },
        },
        (res) => {
          res.resume();
          res.on("end", resolve);
        }
      );
      req.setNoDelay(true);
      req.on("error", reject);
      req.end();
    });
  }

  putDisplayName(displayName, token, onStatus) {
    const accountId = this.accountId();
    if (!accountId) throw new Error("That Epic sign-in is missing an account id.");
    const body = Buffer.from(JSON.stringify({ displayName }));
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: ACCOUNT_HOST,
          path: `/account/api/public/account/${encodeURIComponent(accountId)}`,
          method: "PUT",
          agent: keepAlive,
          headers: {
            Authorization: `bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "Content-Length": String(body.length),
            Connection: "keep-alive",
            "User-Agent": UA,
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let payload = {};
            if (raw) {
              try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed;
              } catch {
                payload = { errorMessage: raw.slice(0, 200) };
              }
            }
            const status = res.statusCode || 0;
            if (status >= 200 && status < 300) {
              const next = payload.displayName || displayName;
              if (this.session) this.session.display_name = next;
              resolve({ ok: true, status, displayName: next, message: "", code: "" });
              return;
            }
            resolve({
              ok: false,
              status,
              displayName: this.displayName(),
              message: clean(payload.errorMessage || payload.message) || `Epic refused the change (${status}).`,
              code: String(payload.errorCode || ""),
            });
          });
          if (onStatus) onStatus(res.statusCode || 0);
        }
      );
      req.setNoDelay(true);
      req.on("timeout", () => req.destroy(new Error("Could not reach Epic.")));
      req.on("error", reject);
      req.end(body);
    });
  }

  async swapOnto(target, tempName, wantedName) {
    const sourceToken = await this.launcherAccessToken();
    const targetToken = await target.launcherAccessToken();
    const settled = await Promise.allSettled([
      openFastLane(sourceToken),
      ...Array.from({ length: 10 }, () => openFastLane(targetToken)),
    ]);
    const lanes = settled
      .filter((item) => item.status === "fulfilled")
      .map((item) => item.value)
      .sort((a, b) => a.rtt - b.rtt);
    if (lanes.length < 2) {
      closeLanes(lanes);
      throw new Error("Could not reach Epic.");
    }
    const releaseLane = lanes[0];
    const claimLanes = lanes.slice(1);
    let releaseOk = null;
    let releaseDoneAt = 0n;
    let winner = null;
    let fatal = null;
    const claimRequest = {
      method: "PUT",
      path: `/account/api/public/account/${encodeURIComponent(target.accountId())}`,
      token: targetToken,
      body: JSON.stringify({ displayName: wantedName }),
    };
    const deadline = process.hrtime.bigint() + 1_200_000_000n;
    const releasePump = createPump(releaseLane.socket);
    const pumps = claimLanes.map((lane) => createPump(lane.socket));
    const noteClaim = (result) => {
      if (!result) return;
      if (result.ok) {
        const shaped = { ...result, displayName: result.displayName || wantedName };
        if (!winner || result.doneAt < winner.doneAt) winner = { result: shaped, doneAt: result.doneAt };
        return;
      }
      if (result.status !== 429 && !isTakenResult(result)) fatal = result;
    };
    const shoot = (pump) => {
      if (!pump || pump.inflight >= 3) return;
      if (pump.holdoff && process.hrtime.bigint() < pump.holdoff) return;
      if (winner || fatal || releaseOk === false) return;
      pump.inflight += 1;
      pump.send(claimRequest).then((result) => {
        pump.inflight -= 1;
        if (result?.status === 429) pump.holdoff = process.hrtime.bigint() + 30_000_000n;
        noteClaim(result);
        if (isTakenResult(result) && releaseOk === true && !winner && !fatal) shoot(pump);
      }).catch(() => {
        pump.inflight -= 1;
      });
    };

    try {
      const releasedReady = releasePump.send({
        method: "PUT",
        path: `/account/api/public/account/${encodeURIComponent(this.accountId())}`,
        token: sourceToken,
        body: JSON.stringify({ displayName: tempName }),
      }).then((result) => {
        releaseDoneAt = result.doneAt || process.hrtime.bigint();
        releaseOk = Boolean(result.ok);
        if (releaseOk && this.session) this.session.display_name = result.displayName || tempName;
        if (releaseOk && !winner) {
          for (const pump of pumps) shoot(pump);
        }
        return {
          ...result,
          displayName: result.displayName || tempName,
          message: result.message || (result.ok ? "" : `Epic refused the change (${result.status}).`),
        };
      }).catch((error) => {
        if (releaseOk == null) releaseOk = false;
        return {
          ok: false,
          status: 0,
          displayName: tempName,
          message: error?.message || "Could not reach Epic.",
        };
      });
      releasePump.send(claimRequest).then(noteClaim).catch(() => {});

      const startedAt = process.hrtime.bigint();
      const spacing = 2_000_000n;
      const maxShots = Math.min(30, Math.max(pumps.length, Math.ceil(releaseLane.rtt / 2)));
      let shotAt = startedAt + spacing;
      for (let shot = 0; shot < maxShots && pumps.length; shot += 1) {
        await waitUntil(shotAt);
        if (winner || releaseOk === false || fatal || process.hrtime.bigint() >= deadline) break;
        shoot(pumps[shot % pumps.length]);
        shotAt += spacing;
      }

      const released = await releasedReady;
      const tail = process.hrtime.bigint() + 350_000_000n;
      while (!winner && releaseOk === true && !fatal && process.hrtime.bigint() < tail && process.hrtime.bigint() < deadline) {
        await waitUntil(process.hrtime.bigint() + 4_000_000n);
      }
      if (winner && target.session) target.session.display_name = winner.result.displayName;
      const gapMs = winner && releaseDoneAt
        ? Math.max(0, Number(winner.doneAt - releaseDoneAt) / 1e6)
        : null;
      this.save();
      target.save();
      return {
        released,
        claimed: winner?.result || fatal,
        gapMs,
      };
    } finally {
      releasePump.close();
      for (const pump of pumps) pump.close();
      closeLanes(lanes);
    }
  }

  async swapChain(middle, keeper, tempName, firstName, secondName) {
    const firstId = this.accountId();
    const middleId = middle.accountId();
    const keeperId = keeper.accountId();
    if (!firstId || !middleId || !keeperId) throw new Error("That Epic sign-in is missing an account id.");
    const firstToken = await this.launcherAccessToken();
    const middleToken = await middle.launcherAccessToken();
    const keeperToken = await keeper.launcherAccessToken();
    const [firstSettled, middleSettled, keeperSettled] = await Promise.all([
      openFastLane(firstToken).then((value) => ({ status: "fulfilled", value })).catch((reason) => ({ status: "rejected", reason })),
      Promise.allSettled(Array.from({ length: 8 }, () => openFastLane(middleToken))),
      Promise.allSettled(Array.from({ length: 6 }, () => openFastLane(keeperToken))),
    ]);
    const middleLanes = middleSettled
      .filter((item) => item.status === "fulfilled")
      .map((item) => item.value)
      .sort((a, b) => a.rtt - b.rtt);
    const keeperLanes = keeperSettled
      .filter((item) => item.status === "fulfilled")
      .map((item) => item.value)
      .sort((a, b) => a.rtt - b.rtt);
    const lanes = [
      ...(firstSettled.status === "fulfilled" ? [firstSettled.value] : []),
      ...middleLanes,
      ...keeperLanes,
    ];
    if (firstSettled.status !== "fulfilled" || !middleLanes.length || !keeperLanes.length) {
      closeLanes(lanes);
      throw new Error("Could not reach Epic.");
    }
    const middleRequest = {
      method: "PUT",
      path: `/account/api/public/account/${encodeURIComponent(middleId)}`,
      token: middleToken,
      body: JSON.stringify({ displayName: firstName }),
    };
    const keeperRequest = {
      method: "PUT",
      path: `/account/api/public/account/${encodeURIComponent(keeperId)}`,
      token: keeperToken,
      body: JSON.stringify({ displayName: secondName }),
    };
    let releaseOk = null;
    let releaseDoneAt = 0n;
    let moved = null;
    let kept = null;
    let fatalMiddle = null;
    let fatalKeeper = null;
    let keeperStarted = false;
    const deadline = process.hrtime.bigint() + 1_200_000_000n;
    const releasePump = createPump(firstSettled.value.socket);
    const middlePumps = middleLanes.map((lane) => createPump(lane.socket));
    const keeperPumps = keeperLanes.map((lane) => createPump(lane.socket));
    const noteKeeper = (result) => {
      if (!result) return;
      if (result.ok) {
        const shaped = { ...result, displayName: result.displayName || secondName };
        if (!kept || result.doneAt < kept.doneAt) kept = { result: shaped, doneAt: result.doneAt };
        return;
      }
      if (result.status !== 429 && !isTakenResult(result)) fatalKeeper = result;
    };
    const shootKeeper = (pump) => {
      if (!pump || pump.inflight >= 3) return;
      if (pump.holdoff && process.hrtime.bigint() < pump.holdoff) return;
      if (!moved || kept || fatalKeeper) return;
      pump.inflight += 1;
      pump.send(keeperRequest).then((result) => {
        pump.inflight -= 1;
        if (result?.status === 429) pump.holdoff = process.hrtime.bigint() + 30_000_000n;
        noteKeeper(result);
        if (isTakenResult(result) && moved && !kept && !fatalKeeper) shootKeeper(pump);
      }).catch(() => {
        pump.inflight -= 1;
      });
    };
    const startKeeper = () => {
      if (keeperStarted || !moved) return;
      keeperStarted = true;
      for (const pump of keeperPumps) shootKeeper(pump);
    };
    const noteMiddle = (result) => {
      if (!result) return;
      if (result.ok) {
        const shaped = { ...result, displayName: result.displayName || firstName };
        if (!moved || result.doneAt < moved.doneAt) moved = { result: shaped, doneAt: result.doneAt };
        startKeeper();
        return;
      }
      if (result.status !== 429 && !isTakenResult(result)) fatalMiddle = result;
    };
    const shootMiddle = (pump) => {
      if (!pump || pump.inflight >= 3) return;
      if (pump.holdoff && process.hrtime.bigint() < pump.holdoff) return;
      if (moved || fatalMiddle || releaseOk === false) return;
      pump.inflight += 1;
      pump.send(middleRequest).then((result) => {
        pump.inflight -= 1;
        if (result?.status === 429) pump.holdoff = process.hrtime.bigint() + 30_000_000n;
        noteMiddle(result);
        if (isTakenResult(result) && releaseOk === true && !moved && !fatalMiddle) shootMiddle(pump);
      }).catch(() => {
        pump.inflight -= 1;
      });
    };

    try {
      const releasedReady = releasePump.send({
        method: "PUT",
        path: `/account/api/public/account/${encodeURIComponent(firstId)}`,
        token: firstToken,
        body: JSON.stringify({ displayName: tempName }),
      }).then((result) => {
        releaseDoneAt = result.doneAt || process.hrtime.bigint();
        releaseOk = Boolean(result.ok);
        if (releaseOk && this.session) this.session.display_name = result.displayName || tempName;
        if (releaseOk && !moved) {
          for (const pump of middlePumps) shootMiddle(pump);
        }
        return {
          ...result,
          displayName: result.displayName || tempName,
          message: result.message || (result.ok ? "" : `Epic refused the change (${result.status}).`),
        };
      }).catch((error) => {
        if (releaseOk == null) releaseOk = false;
        return {
          ok: false,
          status: 0,
          displayName: tempName,
          message: error?.message || "Could not reach Epic.",
        };
      });
      releasePump.send(middleRequest).then(noteMiddle).catch(() => {});

      const startedAt = process.hrtime.bigint();
      const spacing = 2_000_000n;
      const maxShots = Math.min(30, Math.max(middlePumps.length, Math.ceil(firstSettled.value.rtt / 2)));
      let shotAt = startedAt + spacing;
      for (let shot = 0; shot < maxShots && middlePumps.length; shot += 1) {
        await waitUntil(shotAt);
        if (moved || releaseOk === false || fatalMiddle || process.hrtime.bigint() >= deadline) break;
        shootMiddle(middlePumps[shot % middlePumps.length]);
        shotAt += spacing;
      }

      const released = await releasedReady;
      const tail = process.hrtime.bigint() + 350_000_000n;
      while (!moved && releaseOk === true && !fatalMiddle && process.hrtime.bigint() < tail && process.hrtime.bigint() < deadline) {
        await waitUntil(process.hrtime.bigint() + 4_000_000n);
      }
      if (moved?.result?.ok) {
        startKeeper();
        const keepUntil = process.hrtime.bigint() + 800_000_000n;
        while (!kept && !fatalKeeper && process.hrtime.bigint() < keepUntil) {
          for (const pump of keeperPumps) shootKeeper(pump);
          await waitUntil(process.hrtime.bigint() + 4_000_000n);
        }
      }
      const movedResult = moved?.result || fatalMiddle;
      const keptResult = movedResult?.ok ? (kept?.result || fatalKeeper) : null;
      if (movedResult?.ok && middle.session) middle.session.display_name = movedResult.displayName;
      if (keptResult?.ok && keeper.session) keeper.session.display_name = keptResult.displayName;
      const gapMs = moved && releaseDoneAt
        ? Math.max(0, Number(moved.doneAt - releaseDoneAt) / 1e6)
        : null;
      const secondGapMs = kept && moved
        ? Math.max(0, Number(kept.doneAt - moved.doneAt) / 1e6)
        : null;
      this.save();
      middle.save();
      keeper.save();
      return { released, moved: movedResult, kept: keptResult, gapMs, secondGapMs };
    } finally {
      releasePump.close();
      for (const pump of middlePumps) pump.close();
      for (const pump of keeperPumps) pump.close();
      closeLanes(lanes);
    }
  }

  async setDisplayName(displayName, token) {
    const accountId = this.accountId();
    if (!accountId) throw new Error("That Epic sign-in is missing an account id.");
    const access = token || await this.launcherAccessToken();
    const response = await epicFetch(
      `${ACCOUNT}/account/api/public/account/${encodeURIComponent(accountId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `bearer ${access}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": UA,
        },
        body: JSON.stringify({ displayName }),
      }
    );
    const payload = await readJson(response);
    if (response.ok) {
      const next = payload.displayName || displayName;
      if (this.session) this.session.display_name = next;
      this.save();
      return { ok: true, status: response.status, displayName: next, message: "", code: "" };
    }
    return {
      ok: false,
      status: response.status,
      displayName: this.displayName(),
      message: clean(payload.errorMessage || payload.message) || `Epic refused the change (${response.status}).`,
      code: String(payload.errorCode || ""),
    };
  }

  async describeName(name) {
    const queried = String(name || "").trim();
    const wantedId = accountIdFrom(queried);
    if (!wantedId) {
      const issue = localIssue(queried);
      if (issue) return { name: queried, found: false, error: issue };
    }

    const loaders = [
      () => this.gameAccessToken(),
      () => this.launcherAccessToken(),
      () => this.ensureToken(),
    ];
    const state = { record: null, linked: [], links: [], reached: false, miss: false, denied: false, failure: "" };
    let lastError = null;
    let usedToken = false;
    for (const load of loaders) {
      let token = "";
      try {
        token = await load();
      } catch (error) {
        lastError = error;
        const text = error.message || "";
        if (!usedToken && /rejected the saved sign-in|Sign in first|sign-in expired|This sign-in expired/i.test(text)) {
          throw error;
        }
        continue;
      }
      if (!token || (state.record && state.linked.length)) continue;
      usedToken = true;
      if (!state.record && !wantedId) {
        const urls = ACCOUNT_HOSTS.map((host) => (
          `${host}/account/api/public/account/displayName/${encodeURIComponent(queried)}`
        ));
        await this.collectAccount(token, urls, state);
      }
      const id = state.record?.id || wantedId;
      if (id && (!state.record || !state.linked.length)) await this.collectAccount(token, this.profileUrls(id), state);
      if (state.record && state.linked.length) break;
    }
    if (!usedToken && lastError) throw lastError;

    const record = state.record;
    if (!record) {
      if (!state.reached) throw new Error("Could not reach Epic.");
      if (!state.miss && state.failure) throw new Error(state.failure);
      return {
        name: queried,
        found: false,
        error: wantedId ? "No Epic profile uses that account id." : "No Epic profile uses that display name.",
      };
    }

    const info = {
      name: queried,
      found: true,
      error: "",
      accountId: String(record.id || wantedId),
      publicName: String(record.displayName || (wantedId ? "" : queried)),
      country: String(record.country || "").trim(),
      language: String(record.preferredLanguage || "").trim(),
      lastDisplayNameChange: String(record.lastDisplayNameChange || "").trim(),
      displayNameChanges: typeof record.numberOfDisplayNameChanges === "number" ? record.numberOfDisplayNameChanges : null,
      created: "",
      linked: state.linked,
      links: state.links.length ? state.links : readLinks(record.links),
    };

    try {
      const token = await this.ensureToken();
      const started = await epicFetch(
        `${FORTNITE}/fortnite/api/game/v2/profile/${encodeURIComponent(info.accountId)}/public/QueryPublicProfile?profileId=common_public&rvn=-1`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            "User-Agent": UA,
          },
          body: "{}",
        }
      );
      if (started.ok) {
        const profile = await readJson(started);
        const created = profile?.profileChanges?.[0]?.profile?.created;
        if (created) info.created = String(created);
      }
    } catch {
      /* the account profile is still useful without a start date */
    }
    return info;
  }

  async logout() {
    const saved = this.session;
    this.session = null;
    this.portalReady = false;
    this.launcherAccess = "";
    this.launcherExpires = 0;
    this.gameAccess = "";
    this.gameExpires = 0;
    this.gamePending = null;
    this.save();
    const token = saved?.access_token;
    const accountId = saved?.account_id;
    const deviceId = saved?.device_id;
    if (token && accountId && deviceId) {
      await epicFetch(
        `${ACCOUNT}/account/api/public/account/${encodeURIComponent(accountId)}/deviceAuth/${encodeURIComponent(deviceId)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "User-Agent": UA } }
      ).catch(() => {});
    }
    if (token) {
      await epicFetch(
        `${ACCOUNT}/account/api/oauth/sessions/kill/${encodeURIComponent(token)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "User-Agent": UA } }
      ).catch(() => {});
    }
  }
}
