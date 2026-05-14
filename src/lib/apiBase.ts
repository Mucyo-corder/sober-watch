/**
 * API root for fetch(). Empty string = same origin (Vite dev server proxies /api → backend).
 * Set VITE_API_BASE_URL when the UI and API are on different hosts (e.g. production).
 */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL;
  if (raw === undefined || raw === null) return "";
  const s = String(raw).trim();
  if (s === "") return "";
  return s.replace(/\/+$/, "");
}

/** e.g. "/api/logs" or "https://api.example.com/api/logs" */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${p}` : p;
}
