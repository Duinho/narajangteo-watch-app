const fs = require("fs/promises");
const path = require("path");
const http = require("http");
const os = require("os");
const webpush = require("web-push");
const { randomUUID } = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

const PORT = Number.parseInt(process.env.PORT || "3838", 10);
const LISTEN_HOST = "0.0.0.0";
const ROOT_DIR = process.cwd();
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const APP_DATA_DIR = path.join(ROOT_DIR, "app-data");
const STATE_FILE = path.join(APP_DATA_DIR, "dashboard-state.json");
const VAPID_FILE = path.join(APP_DATA_DIR, "webpush-vapid.json");
const RESULTS_DIR = path.join(ROOT_DIR, "output", "results");
const NOTIFY_STATE_DIR = path.join(ROOT_DIR, "output", "state");
const CHECKER_PATH = path.join(ROOT_DIR, "narajangteo-result-check.js");
const ACCESS_CODE = String(process.env.APP_ACCESS_CODE || "").trim();
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || "mailto:noreply@example.com").trim();
const DEFAULT_PUBLIC_BASE_URL = trimTrailingSlash(process.env.APP_BASE_URL || "");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const defaultState = {
  version: 2,
  settings: {
    notificationMode: "webpush",
    publicBaseUrl: DEFAULT_PUBLIC_BASE_URL,
  },
  pushSubscriptions: [],
  watches: [],
};

let state = structuredClone(defaultState);
let runQueue = Promise.resolve();
let vapidConfig = {
  publicKey: "",
  privateKey: "",
  subject: VAPID_SUBJECT,
};

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getLanIp() {
  const networks = os.networkInterfaces();
  for (const items of Object.values(networks)) {
    for (const item of items || []) {
      if (item.family !== "IPv4" || item.internal) {
        continue;
      }

      if (
        item.address.startsWith("10.") ||
        item.address.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(item.address)
      ) {
        return item.address;
      }
    }
  }

  return "127.0.0.1";
}

const LAN_IP = getLanIp();
const LOCAL_OPEN_URL = `http://127.0.0.1:${PORT}`;
const LAN_OPEN_URL = `http://${LAN_IP}:${PORT}`;

function getPublicBaseUrl() {
  return trimTrailingSlash(state.settings.publicBaseUrl || DEFAULT_PUBLIC_BASE_URL || LAN_OPEN_URL);
}

function isoNow() {
  return new Date().toISOString();
}

function normalizeNotice(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/-000$/i, "")
    .toUpperCase();
}

function normalizeOrder(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .padStart(3, "0");
}

function normalizeInterval(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(30, parsed) : 300;
}

function buildResultFilePath(notice, order) {
  return path.join(RESULTS_DIR, `narajangteo_${notice}-${order}_latest.json`);
}

function buildOfficialNoticeUrl(notice, order) {
  return `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${encodeURIComponent(
    notice
  )}&bidPbancOrd=${encodeURIComponent(order)}`;
}

function buildAppResultUrl(notice, order) {
  return `${getPublicBaseUrl()}/result.html?notice=${encodeURIComponent(notice)}&order=${encodeURIComponent(order)}`;
}

function summarizePayload(payload) {
  if (!payload) {
    return null;
  }

  return {
    checkedAt: payload.checkedAt || null,
    state: payload.state || null,
    status: payload.searchRow?.status || null,
    title: payload.searchRow?.title || null,
    plannedOpenAt: payload.searchRow?.plannedOpenAt || null,
    selectedCompany: payload.detail?.selectedCompany || null,
    topBidder: payload.detail?.topBidder || null,
  };
}

function buildWatchNotificationFingerprint(payload) {
  return JSON.stringify({
    state: payload?.state || "",
    status: payload?.searchRow?.status || "",
    selectedCompany:
      payload?.detail?.selectedCompany?.displayName ||
      payload?.detail?.selectedCompany?.companyName ||
      payload?.detail?.topBidder?.companyName ||
      "",
    bidAmount: payload?.detail?.selectedCompany?.bidAmount || payload?.detail?.topBidder?.bidAmount || "",
  });
}

function getNotificationCompany(payload) {
  return payload?.detail?.selectedCompany || payload?.detail?.topBidder || null;
}

function buildPushNotification(watch, payload) {
  const company = getNotificationCompany(payload);
  const companyName = company?.displayName || company?.companyName || "업체 확인 필요";
  const resultStatus = payload?.searchRow?.status || payload?.state || "결과 공개";
  const amount = company?.bidAmount ? ` / ${company.bidAmount}` : "";
  const rate = company?.bidRate ? ` / ${company.bidRate}` : "";

  return {
    title: `나라장터 ${resultStatus}`,
    body: `${companyName}${amount}${rate}\n${watch.label} (${watch.notice}-${watch.order})`,
    tag: `narajangteo-${watch.notice}-${watch.order}`,
    url: buildAppResultUrl(watch.notice, watch.order),
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    notice: watch.notice,
    order: watch.order,
    watchId: watch.id,
    checkedAt: payload?.checkedAt || isoNow(),
  };
}

function buildTestPushNotification() {
  return {
    title: "나라장터 알림 테스트",
    body: "이 알림이 보이면 앱 푸시 연결은 정상입니다.",
    tag: "narajangteo-test",
    url: `${getPublicBaseUrl()}/`,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    checkedAt: isoNow(),
  };
}

function createSubscriptionRecord(subscription, userAgent = "") {
  return {
    id: randomUUID(),
    endpoint: subscription.endpoint,
    keys: subscription.keys || {},
    expirationTime: subscription.expirationTime || null,
    createdAt: isoNow(),
    updatedAt: isoNow(),
    userAgent: String(userAgent || "").trim(),
  };
}

function sanitizeWatch(watch) {
  const notice = normalizeNotice(watch.notice);
  const order = normalizeOrder(watch.order || "000");
  const createdAt = watch.createdAt || isoNow();
  const resultJsonPath = watch.resultJsonPath || buildResultFilePath(notice, order);

  return {
    id: watch.id || randomUUID(),
    label: String(watch.label || "").trim() || `${notice}-${order}`,
    notice,
    order,
    intervalSeconds: normalizeInterval(watch.intervalSeconds),
    enabled: watch.enabled !== false,
    running: false,
    createdAt,
    updatedAt: watch.updatedAt || createdAt,
    nextRunAt: watch.nextRunAt || new Date().toISOString(),
    lastRunStartedAt: watch.lastRunStartedAt || null,
    lastRunEndedAt: watch.lastRunEndedAt || null,
    lastRunReason: watch.lastRunReason || null,
    lastCheckedAt: watch.lastCheckedAt || null,
    lastResult: watch.lastResult || null,
    lastError: watch.lastError || "",
    resultJsonPath,
    lastStdout: watch.lastStdout || "",
    lastStderr: watch.lastStderr || "",
    lastNotificationFingerprint: watch.lastNotificationFingerprint || "",
    lastNotificationAt: watch.lastNotificationAt || null,
    ntfyTopic: String(watch.ntfyTopic || "").trim(),
    ntfyServer: String(watch.ntfyServer || "").trim(),
  };
}

function sortWatches() {
  state.watches.sort((a, b) => {
    if (a.enabled !== b.enabled) {
      return a.enabled ? -1 : 1;
    }

    return String(a.createdAt).localeCompare(String(b.createdAt));
  });
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function loadState() {
  await ensureDir(APP_DATA_DIR);

  try {
    const parsed = JSON.parse(await fs.readFile(STATE_FILE, "utf8"));
    state = {
      version: 2,
      settings: {
        ...defaultState.settings,
        ...(parsed.settings || {}),
      },
      pushSubscriptions: Array.isArray(parsed.pushSubscriptions) ? parsed.pushSubscriptions : [],
      watches: Array.isArray(parsed.watches) ? parsed.watches.map(sanitizeWatch).filter((watch) => watch.notice) : [],
    };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    state = structuredClone(defaultState);
    await saveState();
  }

  if (!state.settings.publicBaseUrl && DEFAULT_PUBLIC_BASE_URL) {
    state.settings.publicBaseUrl = DEFAULT_PUBLIC_BASE_URL;
  }
}

async function saveState() {
  await ensureDir(APP_DATA_DIR);
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

async function ensureVapidConfig() {
  await ensureDir(APP_DATA_DIR);

  const envPublicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
  const envPrivateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();

  if (envPublicKey && envPrivateKey) {
    vapidConfig = {
      publicKey: envPublicKey,
      privateKey: envPrivateKey,
      subject: VAPID_SUBJECT,
    };
  } else {
    const saved = await readJsonIfExists(VAPID_FILE);
    if (saved?.publicKey && saved?.privateKey) {
      vapidConfig = {
        publicKey: saved.publicKey,
        privateKey: saved.privateKey,
        subject: saved.subject || VAPID_SUBJECT,
      };
    } else {
      const generated = webpush.generateVAPIDKeys();
      vapidConfig = {
        publicKey: generated.publicKey,
        privateKey: generated.privateKey,
        subject: VAPID_SUBJECT,
      };
      await fs.writeFile(VAPID_FILE, JSON.stringify(vapidConfig, null, 2), "utf8");
    }
  }

  webpush.setVapidDetails(vapidConfig.subject, vapidConfig.publicKey, vapidConfig.privateKey);
}

function hasWebPush() {
  return Boolean(vapidConfig.publicKey && vapidConfig.privateKey);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(statusCode === 204 ? "" : JSON.stringify(payload));
}

function getAccessCodeFromRequest(req) {
  const authorization = String(req.headers.authorization || "");
  if (authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return String(req.headers["x-app-code"] || "").trim();
}

function isAuthorized(req) {
  if (!ACCESS_CODE) {
    return true;
  }

  return getAccessCodeFromRequest(req) === ACCESS_CODE;
}

function getWatchById(id) {
  return state.watches.find((watch) => watch.id === id) || null;
}

function getWatchByNoticeOrder(notice, order) {
  return (
    state.watches.find((watch) => watch.notice === normalizeNotice(notice) && watch.order === normalizeOrder(order)) ||
    null
  );
}

async function readResultPayloadForWatch(watch) {
  if (!watch?.resultJsonPath) {
    return null;
  }

  try {
    return JSON.parse(await fs.readFile(watch.resultJsonPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function publicConfig() {
  return {
    authRequired: Boolean(ACCESS_CODE),
    push: {
      enabled: hasWebPush(),
      publicKey: vapidConfig.publicKey || "",
      subject: vapidConfig.subject || "",
      subscriptionCount: state.pushSubscriptions.length,
    },
    publicBaseUrl: getPublicBaseUrl(),
    localOpenUrl: LOCAL_OPEN_URL,
    lanOpenUrl: LAN_OPEN_URL,
  };
}

function publicState() {
  return {
    settings: {
      notificationMode: state.settings.notificationMode,
      publicBaseUrl: getPublicBaseUrl(),
    },
    push: {
      enabled: hasWebPush(),
      publicKey: vapidConfig.publicKey || "",
      subject: vapidConfig.subject || "",
      subscriptionCount: state.pushSubscriptions.length,
    },
    watches: state.watches,
    serverTime: isoNow(),
  };
}

function queueWatchRun(watchId, reason = "manual", force = false) {
  runQueue = runQueue
    .then(() => runWatch(watchId, reason, force))
    .catch((error) => {
      console.error(`[queue] ${watchId}`, error);
    });

  return runQueue;
}

async function savePushSubscription(subscription, userAgent) {
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    throw new Error("valid push subscription is required");
  }

  const existing = state.pushSubscriptions.find((item) => item.endpoint === subscription.endpoint);
  if (existing) {
    existing.keys = subscription.keys;
    existing.expirationTime = subscription.expirationTime || null;
    existing.updatedAt = isoNow();
    existing.userAgent = String(userAgent || existing.userAgent || "").trim();
    await saveState();
    return existing;
  }

  const record = createSubscriptionRecord(subscription, userAgent);
  state.pushSubscriptions.push(record);
  await saveState();
  return record;
}

async function removePushSubscription(endpoint) {
  const index = state.pushSubscriptions.findIndex((item) => item.endpoint === endpoint);
  if (index === -1) {
    return false;
  }

  state.pushSubscriptions.splice(index, 1);
  await saveState();
  return true;
}

async function broadcastPush(notification) {
  if (!hasWebPush() || state.pushSubscriptions.length === 0) {
    return {
      sent: 0,
      failed: 0,
      removed: 0,
      endpoints: [],
    };
  }

  const endpoints = [];
  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const subscription of [...state.pushSubscriptions]) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          expirationTime: subscription.expirationTime,
        },
        JSON.stringify(notification)
      );
      sent += 1;
      endpoints.push(subscription.endpoint);
    } catch (error) {
      failed += 1;
      const statusCode = Number(error.statusCode || 0);
      if (statusCode === 404 || statusCode === 410) {
        if (await removePushSubscription(subscription.endpoint)) {
          removed += 1;
        }
      }
    }
  }

  return {
    sent,
    failed,
    removed,
    endpoints,
  };
}

async function notifyWatchIfNeeded(watch, payload) {
  if (payload?.state !== "PUBLISHED") {
    return {
      sent: false,
      reason: "state-not-published",
    };
  }

  const fingerprint = buildWatchNotificationFingerprint(payload);
  if (watch.lastNotificationFingerprint === fingerprint) {
    return {
      sent: false,
      reason: "already-sent",
    };
  }

  const pushResult = await broadcastPush(buildPushNotification(watch, payload));
  watch.lastNotificationFingerprint = fingerprint;
  watch.lastNotificationAt = isoNow();

  return {
    sent: pushResult.sent > 0,
    reason: pushResult.sent > 0 ? "web-push-sent" : "no-device-subscribed",
    push: pushResult,
  };
}

async function runWatch(watchId, reason, force) {
  const watch = getWatchById(watchId);
  if (!watch || watch.running || (!watch.enabled && !force)) {
    return;
  }

  watch.running = true;
  watch.lastRunStartedAt = isoNow();
  watch.lastRunReason = reason;
  watch.lastError = "";
  await saveState();

  const args = [
    CHECKER_PATH,
    "--notice",
    watch.notice,
    "--order",
    watch.order,
    "--output-dir",
    RESULTS_DIR,
    "--state-dir",
    NOTIFY_STATE_DIR,
    "--app-base-url",
    getPublicBaseUrl(),
  ];

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd: ROOT_DIR,
      timeout: 120000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });

    const payload = JSON.parse(await fs.readFile(buildResultFilePath(watch.notice, watch.order), "utf8"));
    const notification = await notifyWatchIfNeeded(watch, payload);

    watch.lastRunEndedAt = isoNow();
    watch.lastCheckedAt = payload.checkedAt || watch.lastRunEndedAt;
    watch.lastResult = summarizePayload(payload);
    watch.lastStdout = stdout.trim();
    watch.lastStderr = stderr.trim();
    watch.lastError = "";
    watch.resultJsonPath = buildResultFilePath(watch.notice, watch.order);
    watch.nextRunAt = new Date(Date.now() + watch.intervalSeconds * 1000).toISOString();
    watch.updatedAt = isoNow();

    if (notification?.reason === "no-device-subscribed") {
      watch.lastStdout = `${watch.lastStdout}\nnotification: no-device-subscribed`.trim();
    }
  } catch (error) {
    watch.lastRunEndedAt = isoNow();
    watch.lastError = error.stderr || error.stdout || error.message || "unknown error";
    watch.nextRunAt = new Date(Date.now() + watch.intervalSeconds * 1000).toISOString();
    watch.updatedAt = isoNow();
  } finally {
    watch.running = false;
    await saveState();
  }
}

async function tick() {
  const now = Date.now();
  for (const watch of state.watches) {
    if (!watch.enabled || watch.running) {
      continue;
    }

    const nextRunAt = watch.nextRunAt ? Date.parse(watch.nextRunAt) : 0;
    if (!nextRunAt || Number.isNaN(nextRunAt) || nextRunAt <= now) {
      queueWatchRun(watch.id, "schedule", false);
    }
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      serverTime: isoNow(),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, publicConfig());
    return true;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, {
      error: "unauthorized",
      authRequired: true,
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, publicState());
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/result") {
    const notice = normalizeNotice(url.searchParams.get("notice") || "");
    const order = normalizeOrder(url.searchParams.get("order") || "000");
    const watch = getWatchByNoticeOrder(notice, order);

    if (!watch) {
      sendJson(res, 404, { error: "watch not found" });
      return true;
    }

    const payload = await readResultPayloadForWatch(watch);
    sendJson(res, 200, {
      watch,
      payload,
      officialUrl: buildOfficialNoticeUrl(watch.notice, watch.order),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/push/subscribe") {
    const body = await readJsonBody(req);
    const subscription = await savePushSubscription(body.subscription, req.headers["user-agent"] || body.userAgent || "");
    sendJson(res, 201, {
      subscriptionId: subscription.id,
      subscriptionCount: state.pushSubscriptions.length,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/push/unsubscribe") {
    const body = await readJsonBody(req);
    const removed = await removePushSubscription(body.endpoint);
    sendJson(res, 200, {
      removed,
      subscriptionCount: state.pushSubscriptions.length,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/push/test") {
    const result = await broadcastPush(buildTestPushNotification());
    sendJson(res, 200, {
      ok: true,
      result,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/watches") {
    const body = await readJsonBody(req);
    const notice = normalizeNotice(body.notice);
    const order = normalizeOrder(body.order || "000");

    if (!notice) {
      sendJson(res, 400, { error: "notice is required" });
      return true;
    }

    if (getWatchByNoticeOrder(notice, order)) {
      sendJson(res, 409, { error: "watch already exists" });
      return true;
    }

    const watch = sanitizeWatch({
      id: randomUUID(),
      label: body.label,
      notice,
      order,
      intervalSeconds: body.intervalSeconds,
      enabled: true,
      createdAt: isoNow(),
      updatedAt: isoNow(),
      nextRunAt: new Date().toISOString(),
    });

    state.watches.push(watch);
    sortWatches();
    await saveState();
    queueWatchRun(watch.id, "create", true);
    sendJson(res, 201, { watch });
    return true;
  }

  if (req.method === "PATCH" && url.pathname === "/api/settings") {
    const body = await readJsonBody(req);
    if (Object.prototype.hasOwnProperty.call(body, "publicBaseUrl")) {
      state.settings.publicBaseUrl = trimTrailingSlash(body.publicBaseUrl);
    }
    state.settings.notificationMode = "webpush";
    await saveState();
    sendJson(res, 200, { settings: state.settings });
    return true;
  }

  const watchMatch = url.pathname.match(/^\/api\/watches\/([^/]+)$/);
  const runMatch = url.pathname.match(/^\/api\/watches\/([^/]+)\/run$/);

  if (req.method === "POST" && runMatch) {
    const watch = getWatchById(runMatch[1]);
    if (!watch) {
      sendJson(res, 404, { error: "watch not found" });
      return true;
    }

    watch.nextRunAt = new Date().toISOString();
    watch.updatedAt = isoNow();
    await saveState();
    queueWatchRun(watch.id, "manual", true);
    sendJson(res, 202, { queued: true });
    return true;
  }

  if (req.method === "PATCH" && watchMatch) {
    const watch = getWatchById(watchMatch[1]);
    if (!watch) {
      sendJson(res, 404, { error: "watch not found" });
      return true;
    }

    const body = await readJsonBody(req);

    if (Object.prototype.hasOwnProperty.call(body, "label")) {
      watch.label = String(body.label || "").trim() || `${watch.notice}-${watch.order}`;
    }

    if (Object.prototype.hasOwnProperty.call(body, "intervalSeconds")) {
      watch.intervalSeconds = normalizeInterval(body.intervalSeconds);
    }

    if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
      watch.enabled = Boolean(body.enabled);
    }

    watch.updatedAt = isoNow();
    if (watch.enabled) {
      watch.nextRunAt = new Date().toISOString();
    }

    await saveState();
    sendJson(res, 200, { watch });
    return true;
  }

  if (req.method === "DELETE" && watchMatch) {
    const index = state.watches.findIndex((watch) => watch.id === watchMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "watch not found" });
      return true;
    }

    state.watches.splice(index, 1);
    await saveState();
    sendJson(res, 204, {});
    return true;
  }

  return false;
}

async function serveStatic(req, res, url) {
  const relativePath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const normalizedPath = path.normalize(relativePath);
  if (normalizedPath.startsWith("..")) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  const filePath = path.join(PUBLIC_DIR, normalizedPath);

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": ext === ".png" || ext === ".svg" ? "public, max-age=86400" : "no-store",
    });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    throw error;
  }
}

function openBrowser(targetUrl) {
  if (process.argv.includes("--no-open")) {
    return;
  }

  if (process.platform === "win32") {
    execFile("cmd", ["/c", "start", "", targetUrl], { windowsHide: true }, () => {});
    return;
  }

  if (process.platform === "darwin") {
    execFile("open", [targetUrl], () => {});
    return;
  }

  execFile("xdg-open", [targetUrl], () => {});
}

async function start() {
  await ensureDir(PUBLIC_DIR);
  await ensureDir(RESULTS_DIR);
  await ensureDir(NOTIFY_STATE_DIR);
  await loadState();
  await ensureVapidConfig();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || `127.0.0.1:${PORT}`}`);

      if (url.pathname.startsWith("/api/")) {
        const handled = await handleApi(req, res, url);
        if (handled) {
          return;
        }
      }

      await serveStatic(req, res, url);
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: error.message || "internal server error" });
    }
  });

  server.listen(PORT, LISTEN_HOST, () => {
    console.log(`Dashboard running at ${LOCAL_OPEN_URL}`);
    console.log(`LAN access URL: ${LAN_OPEN_URL}`);
    console.log(`Public base URL: ${getPublicBaseUrl()}`);
    console.log(`Web Push ready: ${hasWebPush() ? "yes" : "no"}`);
    if (ACCESS_CODE) {
      console.log("Access code protection: enabled");
    }
    openBrowser(LOCAL_OPEN_URL);
  });

  setInterval(() => {
    tick().catch((error) => console.error("[tick]", error));
  }, 5000);
}

start().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
