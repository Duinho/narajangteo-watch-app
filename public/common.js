export const ACCESS_CODE_KEY = "narajangteo.accessCode";

export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export function getAccessCode() {
  return window.localStorage.getItem(ACCESS_CODE_KEY) || "";
}

export function setAccessCode(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    window.localStorage.removeItem(ACCESS_CODE_KEY);
    return;
  }

  window.localStorage.setItem(ACCESS_CODE_KEY, trimmed);
}

export async function loadConfig() {
  const response = await fetch("/api/config", {
    headers: {
      Accept: "application/json",
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new ApiError(data.error || "config load failed", response.status, data);
  }

  return data;
}

export async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const accessCode = getAccessCode();

  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  if (accessCode) {
    headers.set("Authorization", `Bearer ${accessCode}`);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    throw new ApiError(
      (payload && payload.error) || (typeof payload === "string" && payload) || "request failed",
      response.status,
      payload
    );
  }

  return payload;
}

export function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

export function formatInterval(seconds) {
  if (!seconds) {
    return "-";
  }

  if (seconds < 60) {
    return `${seconds}초`;
  }

  const minutes = Math.floor(seconds / 60);
  const remain = seconds % 60;
  return remain ? `${minutes}분 ${remain}초` : `${minutes}분`;
}

export function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}
