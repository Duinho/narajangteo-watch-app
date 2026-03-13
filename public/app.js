import {
  ApiError,
  ensureWorkspaceKey,
  formatDate,
  formatInterval,
  generateWorkspaceKey,
  getAccessCode,
  getWorkspaceKey,
  loadConfig,
  request,
  setAccessCode,
  setWorkspaceKey,
  urlBase64ToUint8Array,
} from "/common.js";

const installButton = document.querySelector("#install-button");
const pushButton = document.querySelector("#push-button");
const unsubscribeButton = document.querySelector("#unsubscribe-button");
const testPushButton = document.querySelector("#test-push-button");
const refreshButton = document.querySelector("#refresh-button");
const watchForm = document.querySelector("#watch-form");
const workspaceForm = document.querySelector("#workspace-form");
const workspaceKeyField = document.querySelector("#workspace-key");
const newWorkspaceButton = document.querySelector("#new-workspace-button");
const copyWorkspaceButton = document.querySelector("#copy-workspace-button");
const watchList = document.querySelector("#watch-list");
const watchCount = document.querySelector("#watch-count");
const serverTime = document.querySelector("#server-time");
const pushStatus = document.querySelector("#push-status");
const summaryStatus = document.querySelector("#summary-status");
const template = document.querySelector("#watch-card-template");

const lockPanel = document.querySelector("#lock-panel");
const lockForm = document.querySelector("#lock-form");
const lockMessage = document.querySelector("#lock-message");
const appShell = document.querySelector("#app-shell");

let config = null;
let serviceWorkerRegistration = null;
let deferredInstallPrompt = null;
let renderTimer = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButton();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallButton();
});

function setLocked(locked, message = "") {
  lockPanel.hidden = !locked;
  appShell.hidden = locked;
  lockMessage.textContent = message;
}

function updateInstallButton() {
  installButton.disabled = !deferredInstallPrompt;
  installButton.textContent = deferredInstallPrompt ? "앱 설치" : "설치 준비됨";
}

async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  if (serviceWorkerRegistration) {
    return serviceWorkerRegistration;
  }

  serviceWorkerRegistration = await navigator.serviceWorker.register("/sw.js");
  return serviceWorkerRegistration;
}

async function getPushSubscription() {
  const registration = await ensureServiceWorker();
  if (!registration || !("PushManager" in window)) {
    return null;
  }

  return registration.pushManager.getSubscription();
}

async function updatePushControls() {
  if (!config?.push?.enabled || !("PushManager" in window) || !("Notification" in window)) {
    pushStatus.textContent = "이 브라우저에서는 앱 푸시를 지원하지 않습니다.";
    pushButton.disabled = true;
    unsubscribeButton.disabled = true;
    testPushButton.disabled = true;
    return;
  }

  const subscription = await getPushSubscription();
  if (subscription) {
    pushStatus.textContent = "이 워크스페이스에 현재 기기가 연결되어 있습니다.";
    pushButton.disabled = true;
    unsubscribeButton.disabled = false;
    testPushButton.disabled = false;
    return;
  }

  pushStatus.textContent = "아직 이 워크스페이스에 푸시가 연결되지 않았습니다.";
  pushButton.disabled = false;
  unsubscribeButton.disabled = true;
  testPushButton.disabled = true;
}

function buildSummary(watch) {
  if (!watch.lastResult) {
    return `
      <p class="summary-main">아직 조회 결과가 없습니다.</p>
      <p class="summary-sub">등록 직후 자동 조회가 실행됩니다.</p>
    `;
  }

  const selectedCompany =
    watch.lastResult.selectedCompany?.displayName ||
    watch.lastResult.selectedCompany?.companyName ||
    watch.lastResult.topBidder?.companyName ||
    "";

  return `
    <p class="summary-main">${watch.lastResult.status || watch.lastResult.state || "상태 없음"}</p>
    <p class="summary-sub">${watch.lastResult.title || "공고명 없음"}</p>
    <p class="summary-sub">${selectedCompany ? `선정업체: ${selectedCompany}` : "선정업체 정보 대기 중"}</p>
    <p class="summary-sub">최근 조회: ${formatDate(watch.lastCheckedAt)}</p>
  `;
}

function renderWatches(data) {
  watchList.innerHTML = "";

  if (!data.watches.length) {
    watchList.innerHTML = `
      <article class="empty-card">
        <h2>내 워크스페이스에 등록된 공고가 없습니다.</h2>
        <p>같은 개인 워크스페이스 코드를 PC와 휴대폰에 넣으면 이 목록만 서로 동기화됩니다.</p>
      </article>
    `;
    return;
  }

  for (const watch of data.watches) {
    const card = template.content.firstElementChild.cloneNode(true);
    const badge = card.querySelector(".badge");
    const resultState = watch.lastResult?.state || "PENDING";

    card.querySelector(".watch-label").textContent = watch.label;
    card.querySelector(".watch-notice").textContent = `${watch.notice}-${watch.order}`;
    card.querySelector(".watch-status").textContent = watch.running
      ? "조회 중"
      : watch.lastResult?.status || (watch.enabled ? "대기 중" : "중지됨");
    card.querySelector(".watch-next-run").textContent = watch.enabled ? formatDate(watch.nextRunAt) : "중지됨";
    card.querySelector(".watch-interval").textContent = formatInterval(watch.intervalSeconds);
    card.querySelector(".watch-summary").innerHTML = buildSummary(watch);
    card.querySelector(".watch-error").textContent = watch.lastError || "";
    card.querySelector(".detail-link").href = `/result.html?notice=${encodeURIComponent(watch.notice)}&order=${encodeURIComponent(
      watch.order
    )}`;

    badge.dataset.state = watch.running ? "running" : resultState === "PUBLISHED" ? "published" : watch.enabled ? "watching" : "stopped";
    badge.textContent = watch.running ? "조회 중" : resultState === "PUBLISHED" ? "결과 공개" : watch.enabled ? "감시 중" : "중지";

    card.querySelector(".run-now").addEventListener("click", async () => {
      await request(`/api/watches/${watch.id}/run`, { method: "POST" });
      await renderState();
    });

    card.querySelector(".toggle-watch").textContent = watch.enabled ? "중지" : "재개";
    card.querySelector(".toggle-watch").addEventListener("click", async () => {
      await request(`/api/watches/${watch.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !watch.enabled }),
      });
      await renderState();
    });

    card.querySelector(".delete-watch").addEventListener("click", async () => {
      const confirmed = window.confirm(`${watch.label} 감시를 삭제할까요?`);
      if (!confirmed) {
        return;
      }

      await request(`/api/watches/${watch.id}`, { method: "DELETE" });
      await renderState();
    });

    watchList.appendChild(card);
  }
}

async function renderState() {
  try {
    const data = await request("/api/state");
    setLocked(false);

    workspaceKeyField.value = getWorkspaceKey();
    watchCount.textContent = `${data.workspace.watchCount}건`;
    serverTime.textContent = formatDate(data.serverTime);
    summaryStatus.textContent = data.push.subscriptionCount
      ? `푸시 연결 ${data.push.subscriptionCount}기기`
      : "푸시 연결 대기";

    renderWatches(data);
    await updatePushControls();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setLocked(true, "보안코드를 입력하면 앱이 열립니다.");
      return;
    }

    watchList.innerHTML = `
      <article class="empty-card">
        <h2>오류</h2>
        <p>${error.message}</p>
      </article>
    `;
  }
}

async function enablePush() {
  if (!config?.push?.publicKey) {
    throw new Error("푸시 공개 키가 없습니다.");
  }

  if (Notification.permission === "denied") {
    throw new Error("브라우저 알림 권한이 차단되어 있습니다.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("알림 권한이 허용되지 않았습니다.");
  }

  const registration = await ensureServiceWorker();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.push.publicKey),
    }));

  await request("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({ subscription }),
  });

  await updatePushControls();
}

async function disablePush() {
  const subscription = await getPushSubscription();
  if (!subscription) {
    await updatePushControls();
    return;
  }

  await request("/api/push/unsubscribe", {
    method: "POST",
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });

  await subscription.unsubscribe();
  await updatePushControls();
}

async function boot() {
  ensureWorkspaceKey();
  config = await loadConfig();
  updateInstallButton();

  if (config.authRequired && !getAccessCode()) {
    setLocked(true, "보안코드를 입력하면 앱이 열립니다.");
  } else {
    setLocked(false);
  }

  workspaceKeyField.value = getWorkspaceKey();
  await ensureServiceWorker();
  await renderState();

  if (renderTimer) {
    window.clearInterval(renderTimer);
  }

  renderTimer = window.setInterval(() => {
    renderState().catch(() => {});
  }, 5000);
}

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  updateInstallButton();
});

pushButton.addEventListener("click", async () => {
  try {
    await enablePush();
    await renderState();
  } catch (error) {
    window.alert(error.message);
  }
});

unsubscribeButton.addEventListener("click", async () => {
  try {
    await disablePush();
    await renderState();
  } catch (error) {
    window.alert(error.message);
  }
});

testPushButton.addEventListener("click", async () => {
  try {
    const result = await request("/api/push/test", { method: "POST" });
    window.alert(`테스트 푸시 전송: 성공 ${result.result.sent}건 / 실패 ${result.result.failed}건`);
  } catch (error) {
    window.alert(error.message);
  }
});

refreshButton.addEventListener("click", () => {
  renderState().catch(() => {});
});

watchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(watchForm);

  try {
    await request("/api/watches", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(formData.entries())),
    });
    watchForm.reset();
    watchForm.order.value = "000";
    watchForm.intervalSeconds.value = "300";
    await renderState();
  } catch (error) {
    window.alert(error.message);
  }
});

workspaceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = new FormData(workspaceForm).get("workspaceKey");
  const normalized = setWorkspaceKey(code);
  if (!normalized) {
    window.alert("유효한 워크스페이스 코드를 입력하세요.");
    return;
  }

  await renderState();
});

newWorkspaceButton.addEventListener("click", async () => {
  const nextKey = setWorkspaceKey(generateWorkspaceKey());
  workspaceKeyField.value = nextKey;
  await renderState();
});

copyWorkspaceButton.addEventListener("click", async () => {
  const value = getWorkspaceKey();
  if (!value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    window.alert("워크스페이스 코드를 복사했습니다.");
  } catch (error) {
    window.alert("클립보드 복사에 실패했습니다.");
  }
});

lockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = new FormData(lockForm).get("accessCode");
  setAccessCode(code);

  try {
    await renderState();
    lockForm.reset();
  } catch (error) {
    window.alert(error.message);
  }
});

boot().catch((error) => {
  setLocked(false);
  watchList.innerHTML = `
    <article class="empty-card">
      <h2>초기화 오류</h2>
      <p>${error.message}</p>
    </article>
  `;
});
