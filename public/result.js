import { ApiError, formatDate, formatInterval, getAccessCode, loadConfig, request, setAccessCode } from "/common.js";

const lockPanel = document.querySelector("#lock-panel");
const lockForm = document.querySelector("#lock-form");
const lockMessage = document.querySelector("#lock-message");
const resultShell = document.querySelector("#result-shell");

const resultTitle = document.querySelector("#result-title");
const resultSubtitle = document.querySelector("#result-subtitle");
const officialLink = document.querySelector("#official-link");
const resultMeta = document.querySelector("#result-meta");
const summary = document.querySelector("#result-summary");
const announcementGrid = document.querySelector("#announcement-grid");
const bidderTableBody = document.querySelector("#bidder-table tbody");
const resultImage = document.querySelector("#result-image");
const reloadButton = document.querySelector("#reload-button");

function setLocked(locked, message = "") {
  lockPanel.hidden = !locked;
  resultShell.hidden = locked;
  lockMessage.textContent = message;
}

function renderMeta(rows) {
  resultMeta.innerHTML = rows
    .map(
      (row) => `
        <div class="meta-card">
          <span class="meta-label">${row.label}</span>
          <strong>${row.value || "-"}</strong>
        </div>
      `
    )
    .join("");
}

function renderAnnouncement(announcement) {
  const entries = Object.entries(announcement || {});
  if (!entries.length) {
    announcementGrid.innerHTML = `<p class="summary-sub">공고 상세 정보가 아직 없습니다.</p>`;
    return;
  }

  announcementGrid.innerHTML = entries
    .map(
      ([key, value]) => `
        <div class="kv-item">
          <span class="meta-label">${key}</span>
          <strong>${value || "-"}</strong>
        </div>
      `
    )
    .join("");
}

function renderBidders(bidders) {
  if (!Array.isArray(bidders) || bidders.length === 0) {
    bidderTableBody.innerHTML = `<tr><td colspan="7">입찰 업체 정보가 아직 없습니다.</td></tr>`;
    return;
  }

  bidderTableBody.innerHTML = bidders
    .map(
      (bidder) => `
        <tr>
          <td>${bidder.rank || bidder.no || "-"}</td>
          <td>${bidder.companyName || "-"}</td>
          <td>${bidder.representative || "-"}</td>
          <td>${bidder.bidAmount || "-"}</td>
          <td>${bidder.bidRate || "-"}</td>
          <td>${bidder.bidAt || "-"}</td>
          <td>${bidder.note || "-"}</td>
        </tr>
      `
    )
    .join("");
}

function renderSummary(payload) {
  if (!payload) {
    summary.innerHTML = `<p class="summary-main">결과 데이터가 없습니다.</p>`;
    return;
  }

  const selectedCompany =
    payload.detail?.selectedCompany?.displayName ||
    payload.detail?.selectedCompany?.companyName ||
    payload.detail?.topBidder?.companyName ||
    "";

  const lines = [
    `<p class="summary-main">${payload.searchRow?.status || payload.state || "상태 없음"}</p>`,
    `<p class="summary-sub">${payload.searchRow?.title || "공고명 없음"}</p>`,
  ];

  if (selectedCompany) {
    lines.push(`<p class="summary-sub">선정업체: ${selectedCompany}</p>`);
  }

  if (payload.detail?.topBidder?.bidAmount) {
    lines.push(`<p class="summary-sub">1순위 금액: ${payload.detail.topBidder.bidAmount}</p>`);
  }

  lines.push(`<p class="summary-sub">최근 확인: ${formatDate(payload.checkedAt)}</p>`);
  summary.innerHTML = lines.join("");
}

async function loadResult() {
  const params = new URLSearchParams(window.location.search);
  const notice = params.get("notice");
  const order = params.get("order") || "000";

  if (!notice) {
    throw new Error("notice parameter is required");
  }

  return request(`/api/result?notice=${encodeURIComponent(notice)}&order=${encodeURIComponent(order)}`);
}

async function boot() {
  const config = await loadConfig();

  if (config.authRequired && !getAccessCode()) {
    setLocked(true, "보안코드를 입력하면 결과 상세를 볼 수 있습니다.");
    return;
  }

  try {
    const data = await loadResult();
    setLocked(false);

    const { watch, payload, officialUrl, screenshotUrl } = data;
    resultTitle.textContent = `${watch.label} (${watch.notice}-${watch.order})`;
    resultSubtitle.textContent = payload?.searchRow?.title || "최근 저장된 개찰 결과를 표시합니다.";
    officialLink.href = officialUrl;

    renderMeta([
      { label: "최근 상태", value: payload?.searchRow?.status || payload?.state || "-" },
      { label: "최근 조회", value: formatDate(payload?.checkedAt || watch.lastCheckedAt) },
      { label: "조회 간격", value: formatInterval(watch.intervalSeconds) },
      {
        label: "선정업체",
        value:
          payload?.detail?.selectedCompany?.displayName ||
          payload?.detail?.selectedCompany?.companyName ||
          payload?.detail?.topBidder?.companyName ||
          "-",
      },
    ]);

    renderSummary(payload);
    renderAnnouncement(payload?.detail?.announcement || {});
    renderBidders(payload?.detail?.bidders || []);

    if (screenshotUrl) {
      resultImage.src = `${screenshotUrl}&_=${Date.now()}`;
      resultImage.hidden = false;
    } else {
      resultImage.hidden = true;
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setLocked(true, "보안코드를 입력하면 결과 상세를 볼 수 있습니다.");
      return;
    }

    resultTitle.textContent = "개찰 결과 상세";
    resultSubtitle.textContent = error.message;
    summary.innerHTML = `<p class="summary-main">${error.message}</p>`;
    announcementGrid.innerHTML = "";
    bidderTableBody.innerHTML = "";
    resultImage.hidden = true;
  }
}

reloadButton.addEventListener("click", () => window.location.reload());

lockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const code = new FormData(lockForm).get("accessCode");
  setAccessCode(code);
  await boot();
});

boot().catch((error) => {
  summary.innerHTML = `<p class="summary-main">${error.message}</p>`;
});
