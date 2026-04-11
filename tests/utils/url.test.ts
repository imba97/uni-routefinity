import { describe, expect, it } from "vite-plus/test";
import { buildUrl, parsePageInstance, parseUrl } from "../../src/utils/url";

describe("utils/url", () => {
  it("buildUrl appends sorted query and preserves existing query", () => {
    expect(buildUrl("/pages/a", { b: 2, a: 1 })).toBe("/pages/a?a=1&b=2");
    expect(buildUrl("/pages/a?x=1", { b: 2 })).toBe("/pages/a?x=1&b=2");
  });

  it("parseUrl normalizes path and keeps stable key", () => {
    const parsed = parseUrl("pages/a?b=2&a=1");
    expect(parsed.path).toBe("/pages/a");
    expect(parsed.fullPath).toBe("/pages/a?a=1&b=2");
    expect(parsed.key).toBe("/pages/a?a=1&b=2");
  });

  it("parsePageInstance reads route and options", () => {
    const parsed = parsePageInstance({ route: "pages/a", options: { z: 9, a: 1 } } as any);
    expect(parsed.path).toBe("/pages/a");
    expect(parsed.fullPath).toBe("/pages/a?a=1&z=9");
  });
});
