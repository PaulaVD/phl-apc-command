import React from "react";
import { createRoot } from "react-dom/client";
import Page from "./app/page";

const ADMIN_SESSION_KEY = "phl_admin_session_v3";

function readAdminSession() {
  try {
    const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.id || !parsed?.code) return null;
    return parsed;
  } catch {
    return null;
  }
}

function migrationApiUrl() {
  const cfg = (window as unknown as { PHL_CONFIG?: { migrationApiUrl?: string } }).PHL_CONFIG;
  const url = cfg?.migrationApiUrl || "/api/migration-workspace";
  return url.replace(/\/$/, "");
}

const session = readAdminSession();
if (!session) {
  const base = window.location.pathname.replace(/\/migration\/?.*$/, "/");
  window.location.replace(`${base}index.html?auth=migration`);
} else {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.includes("/api/workspace") || url.includes("/api/migration-workspace")) {
      const target = migrationApiUrl();
      const headers = new Headers(init?.headers || {});
      headers.set("X-PHL-Admin-Id", session.id);
      headers.set("X-PHL-Admin-Code", session.code);
      headers.set("Content-Type", headers.get("Content-Type") || "application/json");
      return nativeFetch(target, { ...init, headers });
    }
    return nativeFetch(input, init);
  };

  const mount = document.getElementById("root");
  if (mount) createRoot(mount).render(<Page />);
}
