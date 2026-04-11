import { describe, expect, it } from "vite-plus/test";
import { RouteHistoryStore } from "../../src/core/store";

function location(path: string, query: Record<string, string> = {}) {
  const queryPart = Object.keys(query)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${key}=${query[key]}`)
    .join("&");

  const fullPath = queryPart ? `${path}?${queryPart}` : path;
  return {
    path,
    query,
    fullPath,
    key: fullPath,
  };
}

describe("core/store", () => {
  it("deduplicates same-key push", () => {
    const store = new RouteHistoryStore();
    store.push(location("/pages/a"), "navigateTo");
    store.push(location("/pages/a"), "navigateTo");

    expect(store.list()).toHaveLength(1);
  });

  it("trimToIndex keeps expected prefix", () => {
    const store = new RouteHistoryStore();
    store.push(location("/pages/a"), "navigateTo");
    store.push(location("/pages/b"), "navigateTo");
    store.push(location("/pages/c"), "navigateTo");

    store.trimToIndex(1);
    expect(store.list().map((item) => item.path)).toEqual(["/pages/a", "/pages/b"]);
  });

  it("back keeps root when delta exceeds length", () => {
    const store = new RouteHistoryStore();
    store.push(location("/pages/root"), "navigateTo");
    store.push(location("/pages/a"), "navigateTo");
    store.push(location("/pages/b"), "navigateTo");

    store.back(10);
    expect(store.list().map((item) => item.path)).toEqual(["/pages/root"]);
  });
});
