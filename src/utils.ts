import type { RouteLocation } from "./types";

type PageWithOptions = Page.PageInstance & { options?: Record<string, unknown> };

export function buildUrl(url: string, params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) return url;

  const query = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join("&");

  return query ? `${url}?${query}` : url;
}

export function parseUrl(url: string): RouteLocation {
  const [rawPath = "/", rawQuery = ""] = url.split("?");
  const path = normalizePath(rawPath);
  const query = parseQuery(rawQuery);
  const fullPath = buildFullPath(path, query);
  return { path, query, fullPath, key: createRouteKey(path, query) };
}

export function parsePageInstance(page: PageWithOptions): RouteLocation {
  const path = normalizePath(`/${page.route || ""}`);
  const query = normalizeQueryObject(page.options || {});
  const fullPath = buildFullPath(path, query);
  return { path, query, fullPath, key: createRouteKey(path, query) };
}

function createRouteKey(path: string, query: Record<string, string>): string {
  const keys = Object.keys(query).sort((a, b) => a.localeCompare(b));
  if (!keys.length) return path;
  return `${path}?${keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join("&")}`;
}

function buildFullPath(path: string, query: Record<string, string>): string {
  const keys = Object.keys(query);
  if (!keys.length) return path;
  return `${path}?${keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`).join("&")}`;
}

function parseQuery(rawQuery: string): Record<string, string> {
  if (!rawQuery) return {};

  const query: Record<string, string> = {};
  rawQuery
    .split("&")
    .filter(Boolean)
    .forEach((item) => {
      const [rawKey, ...rest] = item.split("=");
      const key = decodeURIComponent(rawKey || "");
      if (!key) return;
      query[key] = decodeURIComponent(rest.join("="));
    });

  return normalizeQueryObject(query);
}

function normalizeQueryObject(query: Record<string, unknown>): Record<string, string> {
  const normalized: Record<string, string> = {};
  Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => {
      normalized[key] = String(query[key]);
    });
  return normalized;
}

function normalizePath(path: string): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}
