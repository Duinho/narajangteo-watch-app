const fs = require("fs/promises");
const path = require("path");
const { chromium } = require("playwright");

const DEFAULT_NOTICE = "R26BK01351984";
const DEFAULT_ORDER = "000";
const DEFAULT_INTERVAL_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 45000;
const DEFAULT_OUTPUT_DIR = path.join(process.cwd(), "output", "results");
const DEFAULT_STATE_DIR = path.join(process.cwd(), "output", "state");
const G2B_MENU_URL = "https://www.g2b.go.kr/link/PNPE027_01/single/";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36";

function parseArgs(argv) {
  const parsed = {
    notice: DEFAULT_NOTICE,
    order: DEFAULT_ORDER,
    watch: false,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    headed: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    outputDir: DEFAULT_OUTPUT_DIR,
    stateDir: DEFAULT_STATE_DIR,
    ntfyTopic: process.env.NTFY_TOPIC || "",
    ntfyServer: process.env.NTFY_SERVER || "https://ntfy.sh",
    ntfyToken: process.env.NTFY_TOKEN || "",
    webhookUrl: process.env.NOTIFY_WEBHOOK_URL || "",
    appBaseUrl: process.env.APP_BASE_URL || "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--notice" && next) {
      parsed.notice = normalizeNotice(next);
      i += 1;
      continue;
    }

    if (arg === "--order" && next) {
      parsed.order = normalizeOrder(next);
      i += 1;
      continue;
    }

    if (arg === "--watch") {
      parsed.watch = true;
      continue;
    }

    if (arg === "--interval" && next) {
      parsed.intervalSeconds = Math.max(30, Number.parseInt(next, 10) || DEFAULT_INTERVAL_SECONDS);
      i += 1;
      continue;
    }

    if (arg === "--headed") {
      parsed.headed = true;
      continue;
    }

    if (arg === "--timeout" && next) {
      parsed.timeoutMs = Math.max(5000, Number.parseInt(next, 10) || DEFAULT_TIMEOUT_MS);
      i += 1;
      continue;
    }

    if (arg === "--output-dir" && next) {
      parsed.outputDir = path.resolve(next);
      i += 1;
      continue;
    }

    if (arg === "--state-dir" && next) {
      parsed.stateDir = path.resolve(next);
      i += 1;
      continue;
    }

    if (arg === "--ntfy-topic" && next) {
      parsed.ntfyTopic = next.trim();
      i += 1;
      continue;
    }

    if (arg === "--ntfy-server" && next) {
      parsed.ntfyServer = next.trim().replace(/\/$/, "");
      i += 1;
      continue;
    }

    if (arg === "--ntfy-token" && next) {
      parsed.ntfyToken = next.trim();
      i += 1;
      continue;
    }

    if (arg === "--webhook-url" && next) {
      parsed.webhookUrl = next.trim();
      i += 1;
      continue;
    }

    if (arg === "--app-base-url" && next) {
      parsed.appBaseUrl = next.trim().replace(/\/$/, "");
      i += 1;
      continue;
    }
  }

  return parsed;
}

function normalizeNotice(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/-000$/i, "");
}

function normalizeOrder(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .padStart(3, "0");
}

function normalizeCombinedNotice(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .toUpperCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDirectUrl(notice, order) {
  return `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${encodeURIComponent(
    notice
  )}&bidPbancOrd=${encodeURIComponent(order)}`;
}

function buildEntryUrls(notice, order) {
  return [buildDirectUrl(notice, order), G2B_MENU_URL];
}

function buildAppResultUrl(baseUrl, notice, order) {
  if (!baseUrl) {
    return "";
  }

  return `${baseUrl}/result.html?notice=${encodeURIComponent(notice)}&order=${encodeURIComponent(order)}`;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonIfExists(filePath) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function setSelectByLabel(page, index, label) {
  await page.evaluate(
    ({ targetIndex, targetLabel }) => {
      const select = document.querySelectorAll("select")[targetIndex];
      if (!select) {
        throw new Error(`select ${targetIndex} not found`);
      }

      const option = Array.from(select.options).find((item) => item.text.trim() === targetLabel);
      if (!option) {
        throw new Error(`option "${targetLabel}" not found`);
      }

      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { targetIndex: index, targetLabel: label }
  );
}

async function openResultSearch(page, notice, order, timeoutMs) {
  await page.goto(buildDirectUrl(notice, order), {
    timeout: timeoutMs,
    waitUntil: "networkidle",
  });

  await page.waitForSelector("select", { timeout: timeoutMs });
  await setSelectByLabel(page, 1, "입찰개찰/낙찰");
  await page.waitForFunction(
    () => {
      const select = document.querySelectorAll("select")[2];
      return select && Array.from(select.options).some((item) => item.text.trim() === "개찰결과분류조회");
    },
    { timeout: timeoutMs }
  );

  await setSelectByLabel(page, 2, "개찰결과분류조회");
  await page.waitForFunction(
    () => document.body.innerText.includes("개찰결과분류조회"),
    { timeout: timeoutMs }
  );
}

async function searchNotice(page, notice, order, timeoutMs) {
  const bidInputs = page.getByRole("textbox", { name: "입찰공고번호" });
  await bidInputs.nth(0).fill(notice);
  await bidInputs.nth(1).fill(order);
  await page.getByRole("button", { name: "검색" }).click();

  await page.waitForFunction(
    () => {
      const grid = document.querySelector('table[title="this is a grid caption."]');
      return Boolean(grid) || document.body.innerText.includes("데이터가 없음");
    },
    { timeout: timeoutMs }
  );

  await sleep(1000);
}

async function readSearchRows(page) {
  return page.locator('table[title="this is a grid caption."]').first().evaluate((table) => {
    const rows = Array.from(table.querySelectorAll("tr")).slice(1);
    return rows
      .map((row, index) => {
        const cells = Array.from(row.querySelectorAll("td")).map((cell) =>
          cell.innerText.replace(/\s+/g, " ").trim()
        );

        if (cells.length < 8) {
          return null;
        }

        return {
          rowIndex: index,
          number: cells[0],
          noticeCombined: cells[1],
          order: cells[2],
          bidType: cells[3],
          title: cells[4],
          demandOrg: cells[5],
          plannedOpenAt: cells[6],
          status: cells[7],
        };
      })
      .filter(Boolean);
  });
}

async function findMatchingRow(page, notice, order) {
  const rows = await readSearchRows(page);
  const targetCombined = normalizeCombinedNotice(`${notice}-${order}`);

  return (
    rows.find((row) => {
      const rowCombined = normalizeCombinedNotice(row.noticeCombined);
      return rowCombined === targetCombined || rowCombined === normalizeCombinedNotice(notice + order);
    }) || null
  );
}

async function openResultDetail(page, rowIndex, timeoutMs) {
  const grid = page.locator('table[title="this is a grid caption."]').first();
  const row = grid.locator("tr").nth(rowIndex + 1);
  const button = row.getByRole("button").first();
  await button.click();
  await page.waitForFunction(() => document.body.innerText.includes("개찰결과"), {
    timeout: timeoutMs,
  });
  await sleep(1000);
}

function describeError(error) {
  if (!error) {
    return "unknown error";
  }

  return String(error.message || error).replace(/\s+/g, " ").trim();
}

function isRetryableNavigationError(error) {
  const message = describeError(error);
  return (
    /ERR_CONNECTION_RESET/i.test(message) ||
    /ERR_NETWORK_CHANGED/i.test(message) ||
    /ERR_CONNECTION_CLOSED/i.test(message) ||
    /ERR_HTTP2_PROTOCOL_ERROR/i.test(message) ||
    /Navigation timeout/i.test(message) ||
    /net::ERR_ABORTED/i.test(message) ||
    /Target page, context or browser has been closed/i.test(message)
  );
}

async function configurePage(page, timeoutMs) {
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);
}

async function openEntryPageStable(context, notice, order, timeoutMs) {
  let lastError = null;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    for (const targetUrl of buildEntryUrls(notice, order)) {
      const page = await context.newPage();
      await configurePage(page, timeoutMs);

      try {
        await page.goto(targetUrl, {
          timeout: timeoutMs,
          waitUntil: "domcontentloaded",
        });
        await page.waitForSelector("select", { timeout: timeoutMs });
        return page;
      } catch (error) {
        lastError = error;
        await page.close().catch(() => {});
      }
    }

    if (!isRetryableNavigationError(lastError) && attempt >= 2) {
      break;
    }

    await sleep(Math.min(1500 * attempt, 5000));
  }

  throw new Error(`나라장터 진입 실패: ${describeError(lastError)}`);
}

async function openResultSearchStable(page, timeoutMs) {
  await page.waitForSelector("select", { timeout: timeoutMs });
  await setSelectByLabel(page, 1, "입찰개찰/낙찰");
  await page.waitForFunction(
    () => {
      const select = document.querySelectorAll("select")[2];
      return select && Array.from(select.options).some((item) => item.text.trim() === "개찰결과분류조회");
    },
    { timeout: timeoutMs }
  );

  await setSelectByLabel(page, 2, "개찰결과분류조회");
  await page.waitForSelector('input[title="입찰공고번호"]', { timeout: timeoutMs });
}

async function clickSearchButtonStable(page) {
  const selectors = [
    "#mf_wfm_container_btnS0001",
    'input[type="button"][value="검색"]',
    'input[type="button"][title="검색"]',
    "input.w2trigger.btn_cm.srch",
  ];

  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await locator.click();
      return;
    }
  }

  await page.evaluate(() => {
    const trigger = Array.from(document.querySelectorAll('input[type="button"], button, a')).find((item) => {
      const label = (item.innerText || item.value || item.title || "").replace(/\s+/g, "").trim();
      return label === "검색";
    });

    if (!trigger) {
      throw new Error("검색 버튼을 찾지 못했습니다.");
    }

    trigger.click();
  });
}

async function searchNoticeStable(page, notice, order, timeoutMs) {
  const bidInputs = page.locator('input[title="입찰공고번호"]');
  await bidInputs.first().waitFor({ timeout: timeoutMs });

  if ((await bidInputs.count()) < 2) {
    throw new Error("입찰공고번호 입력칸을 찾지 못했습니다.");
  }

  await bidInputs.nth(0).fill(notice);
  await bidInputs.nth(1).fill(order);
  await clickSearchButtonStable(page);

  await page.waitForFunction(
    () => {
      const grid = Array.from(document.querySelectorAll("table")).find((table) => {
        const caption = table.querySelector("caption")?.innerText.trim() || "";
        const text = table.innerText || "";
        return (
          caption.includes("this is a grid caption.") &&
          text.includes("공고번호") &&
          text.includes("재입찰번호") &&
          text.includes("진행상태")
        );
      });

      return Boolean(grid) || document.body.innerText.includes("데이터가 없음");
    },
    { timeout: timeoutMs }
  );

  await sleep(1500);
}

async function searchNoticeStableV2(page, notice, order, timeoutMs) {
  await page.waitForFunction(
    () => {
      const primary = document.querySelector("#mf_wfm_container_ibxBidPbancNo");
      const inputs = primary?.closest("td")?.querySelectorAll('input[type="text"]') || [];
      return Boolean(primary) && inputs.length >= 2;
    },
    { timeout: timeoutMs }
  );

  const inputIds = await page.evaluate(() => {
    const primary = document.querySelector("#mf_wfm_container_ibxBidPbancNo");
    const inputs = primary?.closest("td")?.querySelectorAll('input[type="text"]') || [];
    return Array.from(inputs)
      .slice(0, 2)
      .map((item) => item.id)
      .filter(Boolean);
  });

  if (inputIds.length < 2) {
    throw new Error("입찰공고번호 입력칸을 찾지 못했습니다.");
  }

  await page.locator(`#${inputIds[0]}`).fill(notice);
  await page.locator(`#${inputIds[1]}`).fill(order);
  await clickSearchButtonStable(page);

  await page.waitForFunction(
    () => {
      const grid = Array.from(document.querySelectorAll("table")).find((table) => {
        const caption = table.querySelector("caption")?.innerText.trim() || "";
        const text = table.innerText || "";
        return (
          caption.includes("this is a grid caption.") &&
          text.includes("공고번호") &&
          text.includes("재입찰번호") &&
          text.includes("진행상태")
        );
      });

      return Boolean(grid) || document.body.innerText.includes("데이터가 없음");
    },
    { timeout: timeoutMs }
  );

  await sleep(1500);
}

async function readSearchRowsStable(page) {
  return page.evaluate(() => {
    const table = Array.from(document.querySelectorAll("table")).find((item) => {
      const caption = item.querySelector("caption")?.innerText.trim() || "";
      const text = item.innerText || "";
      return (
        caption.includes("this is a grid caption.") &&
        text.includes("공고번호") &&
        text.includes("재입찰번호") &&
        text.includes("진행상태")
      );
    });

    if (!table) {
      return [];
    }

    return Array.from(table.querySelectorAll("tr"))
      .slice(1)
      .map((row, index) => {
        const cells = Array.from(row.querySelectorAll("td")).map((cell) =>
          cell.innerText.replace(/\s+/g, " ").trim()
        );

        if (cells.length < 8) {
          return null;
        }

        return {
          rowIndex: index,
          number: cells[0],
          noticeCombined: cells[1],
          order: cells[2],
          bidType: cells[3],
          title: cells[4],
          demandOrg: cells[5],
          plannedOpenAt: cells[6],
          status: cells[7],
        };
      })
      .filter(Boolean);
  });
}

async function findMatchingRowStable(page, notice, order) {
  const rows = await readSearchRowsStable(page);
  const targetCombined = normalizeCombinedNotice(`${notice}-${order}`);

  return (
    rows.find((row) => {
      const rowCombined = normalizeCombinedNotice(row.noticeCombined);
      return rowCombined === targetCombined || rowCombined === normalizeCombinedNotice(notice + order);
    }) || null
  );
}

async function openResultDetailStable(page, rowIndex, timeoutMs) {
  await page.evaluate((targetRowIndex) => {
    const table = Array.from(document.querySelectorAll("table")).find((item) => {
      const caption = item.querySelector("caption")?.innerText.trim() || "";
      const text = item.innerText || "";
      return (
        caption.includes("this is a grid caption.") &&
        text.includes("공고번호") &&
        text.includes("재입찰번호") &&
        text.includes("진행상태")
      );
    });

    if (!table) {
      throw new Error("검색 결과 표를 찾지 못했습니다.");
    }

    const row = table.querySelectorAll("tr")[targetRowIndex + 1];
    const trigger = row?.querySelector('button, input[type="button"], a');
    if (!trigger) {
      throw new Error("개찰결과 상세 버튼을 찾지 못했습니다.");
    }

    trigger.click();
  }, rowIndex);

  await page.waitForFunction(
    () => document.body.innerText.includes("개찰결과") && document.body.innerText.includes("사업자등록번호"),
    { timeout: timeoutMs }
  );
  await sleep(1500);
}

async function extractLabeledTableStable(page, headingText) {
  return page.evaluate((targetHeading) => {
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, strong, dt, label"));
    const heading = headings.find((item) => item.textContent.replace(/\s+/g, " ").trim() === targetHeading);
    if (!heading) {
      return {};
    }

    const wrapper = heading.parentElement?.parentElement || heading.parentElement;
    const table = wrapper?.querySelector("table");
    if (!table) {
      return {};
    }

    const data = {};
    for (const row of Array.from(table.querySelectorAll("tr"))) {
      const cells = Array.from(row.children);
      for (let i = 0; i < cells.length - 1; i += 2) {
        const key = cells[i].innerText.replace(/\s+/g, " ").trim();
        const value = cells[i + 1].innerText.replace(/\s+/g, " ").trim();
        if (key) {
          data[key] = value;
        }
      }
    }

    return data;
  }, headingText);
}

async function extractBidderRowsStable(page) {
  return page.evaluate(() => {
    const bidderGrid = Array.from(document.querySelectorAll("table")).find((table) => {
      const text = table.innerText || "";
      return text.includes("사업자등록번호") && text.includes("업체명") && text.includes("입찰금액");
    });

    if (!bidderGrid) {
      return [];
    }

    return Array.from(bidderGrid.querySelectorAll("tr"))
      .slice(1)
      .map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.innerText.replace(/\s+/g, " ").trim()))
      .filter((cells) => cells.length >= 10)
      .map((cells) => ({
        no: cells[0],
        rank: cells[1],
        businessNumber: cells[2],
        companyName: cells[3],
        representative: cells[4],
        bidAmount: cells[5],
        bidRate: cells[6],
        quantity: cells[7],
        lotteryNumber: cells[8],
        bidAt: cells[9],
        note: cells[10] || "",
      }));
  });
}

async function extractDetailStable(page) {
  const announcement = await extractLabeledTableStable(page, "공고정보");
  const bidders = await extractBidderRowsStable(page);
  const topBidder = bidders[0] || null;

  return {
    announcement,
    bidders,
    topBidder,
    selectedCompany: deriveSelectedCompany({ announcement, bidders, topBidder }),
    pageText: (await page.textContent("body"))?.replace(/\s+/g, " ").trim() || "",
  };
}

async function extractLabeledTable(page, headingText) {
  return page.evaluate((targetHeading) => {
    const headings = Array.from(document.querySelectorAll("h4"));
    const heading = headings.find((item) => item.textContent.trim() === targetHeading);
    if (!heading) {
      return {};
    }

    const wrapper = heading.parentElement?.parentElement || heading.parentElement;
    const table = wrapper?.querySelector("table");
    if (!table) {
      return {};
    }

    const data = {};
    for (const row of Array.from(table.querySelectorAll("tr"))) {
      const cells = Array.from(row.children);
      for (let i = 0; i < cells.length - 1; i += 2) {
        const key = cells[i].innerText.replace(/\s+/g, " ").trim();
        const valueCell = cells[i + 1];
        const value = valueCell.innerText.replace(/\s+/g, " ").trim();
        if (key) {
          data[key] = value;
        }
      }
    }

    return data;
  }, headingText);
}

async function extractBidderRows(page) {
  return page.evaluate(() => {
    const grids = Array.from(document.querySelectorAll('table[title="this is a grid caption."]'));
    const bidderGrid = grids.find((table) => table.innerText.includes("사업자등록번호") && table.innerText.includes("업체명"));
    if (!bidderGrid) {
      return [];
    }

    return Array.from(bidderGrid.querySelectorAll("tr"))
      .slice(1)
      .map((row) => Array.from(row.querySelectorAll("td")).map((cell) => cell.innerText.replace(/\s+/g, " ").trim()))
      .filter((cells) => cells.length >= 10)
      .map((cells) => ({
        no: cells[0],
        rank: cells[1],
        businessNumber: cells[2],
        companyName: cells[3],
        representative: cells[4],
        bidAmount: cells[5],
        bidRate: cells[6],
        quantity: cells[7],
        lotteryNumber: cells[8],
        bidAt: cells[9],
        note: cells[10] || "",
      }));
  });
}

function normalizePlainText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function findAnnouncementEntry(announcement, patterns) {
  if (!announcement || typeof announcement !== "object") {
    return null;
  }

  for (const [key, value] of Object.entries(announcement)) {
    const sourceLabel = normalizePlainText(key);
    const normalizedValue = normalizePlainText(value);
    if (!normalizedValue || normalizedValue === "-") {
      continue;
    }

    if (patterns.some((pattern) => pattern.test(sourceLabel))) {
      return {
        sourceLabel,
        value: normalizedValue,
      };
    }
  }

  return null;
}

function findBidderByNote(bidders, patterns) {
  for (const bidder of bidders || []) {
    const note = normalizePlainText(bidder?.note);
    if (!note) {
      continue;
    }

    if (patterns.some((pattern) => pattern.test(note))) {
      return bidder;
    }
  }

  return null;
}

function deriveSelectedCompany(detail) {
  const bidders = Array.isArray(detail?.bidders) ? detail.bidders : [];
  const announcementEntry = findAnnouncementEntry(detail?.announcement, [
    /선정업체/,
    /선정 업체/,
    /선정자/,
    /낙찰업체/,
    /낙찰 업체/,
    /낙찰자/,
    /계약상대자/,
    /계약 상대자/,
  ]);

  if (announcementEntry) {
    const matchedBidder =
      bidders.find((bidder) => {
        const companyName = normalizePlainText(bidder?.companyName);
        return companyName && announcementEntry.value.includes(companyName);
      }) || null;

    return {
      ...(matchedBidder || {}),
      companyName: matchedBidder?.companyName || announcementEntry.value,
      displayName: matchedBidder?.companyName || announcementEntry.value,
      rawValue: announcementEntry.value,
      source: "announcement",
      sourceLabel: announcementEntry.sourceLabel,
    };
  }

  const bidderFromNote = findBidderByNote(bidders, [/선정/, /낙찰/, /계약상대/, /적격/]);
  if (bidderFromNote?.companyName) {
    return {
      ...bidderFromNote,
      companyName: bidderFromNote.companyName,
      displayName: bidderFromNote.companyName,
      source: "bidder-note",
      sourceLabel: "투찰업체 비고",
    };
  }

  if (detail?.topBidder?.companyName) {
    return {
      ...detail.topBidder,
      companyName: detail.topBidder.companyName,
      displayName: detail.topBidder.companyName,
      source: "top-bidder",
      sourceLabel: "1순위 업체",
    };
  }

  return null;
}

async function extractDetail(page) {
  const announcement = await extractLabeledTable(page, "공고정보");
  const bidders = await extractBidderRows(page);
  const topBidder = bidders[0] || null;
  return {
    announcement,
    bidders,
    topBidder,
    selectedCompany: deriveSelectedCompany({ announcement, bidders, topBidder }),
    pageText: (await page.textContent("body"))?.replace(/\s+/g, " ").trim() || "",
  };
}

async function writeOutputs(outputDir, key, payload) {
  await ensureDir(outputDir);
  const jsonPath = path.join(outputDir, `${key}.json`);
  const textPath = path.join(outputDir, `${key}.txt`);

  const summaryLines = [
    `checkedAt: ${payload.checkedAt}`,
    `notice: ${payload.notice}-${payload.order}`,
    `state: ${payload.state}`,
  ];

  if (payload.searchRow) {
    summaryLines.push(`status: ${payload.searchRow.status}`);
    summaryLines.push(`title: ${payload.searchRow.title}`);
    summaryLines.push(`plannedOpenAt: ${payload.searchRow.plannedOpenAt}`);
  }

  if (payload.detail?.topBidder) {
    summaryLines.push(`topBidder: ${payload.detail.topBidder.companyName}`);
    summaryLines.push(`topBidAmount: ${payload.detail.topBidder.bidAmount}`);
    summaryLines.push(`topBidRate: ${payload.detail.topBidder.bidRate}`);
  }

  if (payload.detail?.selectedCompany?.displayName || payload.detail?.selectedCompany?.companyName) {
    summaryLines.push(
      `selectedCompany: ${payload.detail.selectedCompany.displayName || payload.detail.selectedCompany.companyName}`
    );
  }

  await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(textPath, `${summaryLines.join("\n")}\n`, "utf8");

  return { jsonPath, textPath };
}

function buildResultUrl(options, notice, order) {
  return buildAppResultUrl(options.appBaseUrl, notice, order) || buildDirectUrl(notice, order);
}

function getNotificationCompany(payload) {
  return payload.detail?.selectedCompany || payload.detail?.topBidder || null;
}

function buildNotificationTitle(payload) {
  const company = getNotificationCompany(payload);
  const companyName = company?.displayName || company?.companyName || `${payload.notice}-${payload.order}`;
  const status = payload.searchRow?.status || "결과 공개";
  const title = `나라장터 ${status}: ${companyName}`;
  return title.length > 110 ? `${title.slice(0, 107)}...` : title;
}

function buildNotificationText(options, payload) {
  const lines = [];
  const company = getNotificationCompany(payload);
  const companyName = company?.displayName || company?.companyName || "";
  const companyLabel = company?.source === "top-bidder" ? "1순위업체" : "선정업체";

  if (payload.searchRow?.status) {
    lines.push(`개찰결과: ${payload.searchRow.status}`);
  } else {
    lines.push(`개찰결과: ${payload.state}`);
  }

  if (companyName) {
    lines.push(`${companyLabel}: ${companyName}`);
  }

  lines.push(`공고번호: ${payload.notice}-${payload.order}`);

  if (payload.searchRow?.title) {
    lines.push(`공고명: ${payload.searchRow.title}`);
  }

  if (payload.searchRow?.status) {
    lines.push(`상태: ${payload.searchRow.status}`);
  }

  if (payload.detail?.announcement?.["실제개찰일시"]) {
    lines.push(`실제개찰일시: ${payload.detail.announcement["실제개찰일시"]}`);
  }

  if (company?.bidAmount) {
    lines.push(`금액: ${company.bidAmount}`);
  }

  if (company?.bidRate) {
    lines.push(`투찰률: ${company.bidRate}`);
  }

  if (company?.sourceLabel && company?.source !== "top-bidder") {
    lines.push(`확인항목: ${company.sourceLabel}`);
  }

  if (!companyName && payload.detail?.topBidder) {
    lines.push(`1순위: ${payload.detail.topBidder.companyName}`);
    lines.push(`입찰금액: ${payload.detail.topBidder.bidAmount}`);
    if (payload.detail.topBidder.bidRate) {
      lines.push(`투찰률: ${payload.detail.topBidder.bidRate}`);
    }
  }

  lines.push(`조회시각: ${payload.checkedAt}`);

  return lines.join("\n");
}

async function sendNtfyNotification(options, payload) {
  if (!options.ntfyTopic) {
    return null;
  }

  const endpoint = `${options.ntfyServer}/${encodeURIComponent(options.ntfyTopic)}/${encodeURIComponent(
    `narajangteo-${payload.notice}-${payload.order}`
  )}`;

  const headers = {
    Title: buildNotificationTitle(payload),
    Priority: "urgent",
    Tags: "rotating_light,briefcase",
    Markdown: "yes",
  };

  if (options.ntfyToken) {
    headers.Authorization = `Bearer ${options.ntfyToken}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: buildNotificationText(options, payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`ntfy notification failed: ${response.status} ${text}`);
  }

  return {
    provider: "ntfy",
    endpoint,
  };
}

async function sendWebhookNotification(options, payload) {
  if (!options.webhookUrl) {
    return null;
  }

  const response = await fetch(options.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "narajangteo-result-check",
      notice: `${payload.notice}-${payload.order}`,
      state: payload.state,
      status: payload.searchRow?.status || null,
      title: payload.searchRow?.title || null,
      checkedAt: payload.checkedAt,
      resultUrl: buildResultUrl(options, payload.notice, payload.order),
      officialUrl: buildDirectUrl(payload.notice, payload.order),
      selectedCompany: payload.detail?.selectedCompany || null,
      topBidder: payload.detail?.topBidder || null,
      payload,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`webhook notification failed: ${response.status} ${text}`);
  }

  return {
    provider: "webhook",
    endpoint: options.webhookUrl,
  };
}

async function notifyIfNeeded(options, payload) {
  if (payload.state !== "PUBLISHED") {
    return {
      sent: false,
      reason: "state-not-published",
    };
  }

  await ensureDir(options.stateDir);
  const stateFile = path.join(options.stateDir, `narajangteo_${payload.notice}-${payload.order}_notify-state.json`);
  const previous = await readJsonIfExists(stateFile);
  const currentFingerprint = JSON.stringify({
    state: payload.state,
    status: payload.searchRow?.status || "",
    selectedCompany:
      payload.detail?.selectedCompany?.displayName ||
      payload.detail?.selectedCompany?.companyName ||
      payload.detail?.topBidder?.companyName ||
      "",
    bidAmount: payload.detail?.selectedCompany?.bidAmount || payload.detail?.topBidder?.bidAmount || "",
  });

  if (previous?.fingerprint === currentFingerprint) {
    return {
      sent: false,
      reason: "already-sent",
    };
  }

  const results = [];

  if (options.ntfyTopic) {
    results.push(await sendNtfyNotification(options, payload));
  }

  if (options.webhookUrl) {
    results.push(await sendWebhookNotification(options, payload));
  }

  await fs.writeFile(
    stateFile,
    JSON.stringify(
      {
        fingerprint: currentFingerprint,
        sentAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    sent: results.length > 0,
    reason: results.length > 0 ? "sent" : "no-provider-configured",
    results: results.filter(Boolean),
    stateFile,
  };
}

async function runOnce(browser, options) {
  const context = await browser.newContext({
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    viewport: { width: 1440, height: 1400 },
    userAgent: DEFAULT_USER_AGENT,
    extraHTTPHeaders: {
      "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8",
    },
  });
  let page = null;

  try {
    page = await openEntryPageStable(context, options.notice, options.order, options.timeoutMs);
    await openResultSearchStable(page, options.timeoutMs);
    await searchNoticeStableV2(page, options.notice, options.order, options.timeoutMs);
    const originalGetByText = page.getByText.bind(page);
    page.getByText = (text, ...args) => {
      if (text === "?곗씠?곌? ?놁쓬") {
        return originalGetByText("데이터가 없음", ...args);
      }

      return originalGetByText(text, ...args);
    };

    const checkedAt = new Date().toLocaleString("sv-SE", {
      timeZone: "Asia/Seoul",
    }).replace(" ", "T");

    if (await page.getByText("데이터가 없음").isVisible()) {
      const payload = {
        checkedAt,
        notice: options.notice,
        order: options.order,
        state: "NOT_PUBLISHED",
        searchRow: null,
        detail: null,
      };
      const files = await writeOutputs(
        options.outputDir,
        `narajangteo_${options.notice}-${options.order}_latest`,
        payload
      );
      const notification = await notifyIfNeeded(options, payload);

      return { payload, files, notification };
    }

    const matchingRow = await findMatchingRowStable(page, options.notice, options.order);

    if (!matchingRow) {
      const payload = {
        checkedAt,
        notice: options.notice,
        order: options.order,
        state: "NOT_FOUND_IN_CURRENT_FILTER",
        searchRow: null,
        detail: null,
      };
      const files = await writeOutputs(
        options.outputDir,
        `narajangteo_${options.notice}-${options.order}_latest`,
        payload
      );
      const notification = await notifyIfNeeded(options, payload);

      return { payload, files, notification };
    }

    await openResultDetailStable(page, matchingRow.rowIndex, options.timeoutMs);
    const detail = await extractDetailStable(page);
    const payload = {
      checkedAt,
      notice: options.notice,
      order: options.order,
      state: "PUBLISHED",
      searchRow: matchingRow,
      detail,
    };
    const files = await writeOutputs(
      options.outputDir,
      `narajangteo_${options.notice}-${options.order}_latest`,
      payload
    );
    const notification = await notifyIfNeeded(options, payload);

    return { payload, files, notification };
  } finally {
    await context.close();
  }
}

function printSummary(result) {
  const { payload, files, notification } = result;

  console.log("");
  console.log(`[${payload.checkedAt}] ${payload.notice}-${payload.order}`);
  console.log(`state: ${payload.state}`);

  if (payload.searchRow) {
    console.log(`status: ${payload.searchRow.status}`);
    console.log(`title: ${payload.searchRow.title}`);
    console.log(`plannedOpenAt: ${payload.searchRow.plannedOpenAt}`);
  } else {
    console.log("status: 미게시 또는 목록 미노출");
  }

  if (payload.detail?.topBidder) {
    console.log(`topBidder: ${payload.detail.topBidder.companyName}`);
    console.log(`topBidAmount: ${payload.detail.topBidder.bidAmount}`);
    console.log(`topBidRate: ${payload.detail.topBidder.bidRate}`);
  }

  if (payload.detail?.selectedCompany?.displayName || payload.detail?.selectedCompany?.companyName) {
    console.log(
      `selectedCompany: ${payload.detail.selectedCompany.displayName || payload.detail.selectedCompany.companyName}`
    );
  }

  console.log(`json: ${files.jsonPath}`);
  console.log(`text: ${files.textPath}`);
  if (notification) {
    console.log(`notification: ${notification.reason}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: !options.headed });

  try {
    do {
      const result = await runOnce(browser, options);
      printSummary(result);

      if (!options.watch || result.payload.state === "PUBLISHED") {
        if (options.watch && result.payload.state === "PUBLISHED") {
          process.stdout.write("\x07");
        }
        break;
      }

      console.log(`다음 조회까지 ${options.intervalSeconds}초 대기합니다.`);
      await sleep(options.intervalSeconds * 1000);
    } while (true);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
