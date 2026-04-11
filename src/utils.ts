import type { RouteLocation } from "./types";

type PageWithOptions = Page.PageInstance & { options?: Record<string, unknown> };

export function buildUrl(url: string, params?: Record<string, unknown>): string {
  if (!params || Object.keys(params).length === 0) return url;

  const query = stringifyQuery(params, true);
  if (!query) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${query}`;
}

export function parseUrl(url: string): RouteLocation {
  const queryIndex = url.indexOf("?");
  const rawPath = queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  const rawQuery = queryIndex >= 0 ? url.slice(queryIndex + 1) : "";
  const path = normalizePath(rawPath);
  const query = parseQuery(rawQuery);
  const queryString = stringifyQuery(query, false);
  const fullPath = queryString ? `${path}?${queryString}` : path;
  return { path, query, fullPath, key: createRouteKey(path, queryString) };
}

export function parsePageInstance(page: PageWithOptions): RouteLocation {
  const path = normalizePath(`/${page.route || ""}`);
  const query = normalizeQueryObject(page.options || {});
  const queryString = stringifyQuery(query, false);
  const fullPath = queryString ? `${path}?${queryString}` : path;
  return { path, query, fullPath, key: createRouteKey(path, queryString) };
}

function createRouteKey(path: string, queryString: string): string {
  return queryString ? `${path}?${queryString}` : path;
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

function stringifyQuery(
  query: Record<string, unknown> | Record<string, string>,
  shouldSortKeys: boolean,
): string {
  const keys = Object.keys(query).filter((key) => query[key] !== undefined && query[key] !== null);
  if (!keys.length) return "";

  if (shouldSortKeys) {
    keys.sort((a, b) => a.localeCompare(b));
  }

  return keys
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(query[key]))}`)
    .join("&");
}

function normalizePath(path: string): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}
