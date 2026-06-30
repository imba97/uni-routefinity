import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

type PageLike = {
  route: string;
  options?: Record<string, unknown>;
};

type UniArgs = {
  url?: string;
  delta?: number;
  success?: (result?: unknown) => void;
  fail?: (error?: unknown) => void;
  complete?: (result?: unknown) => void;
};

type Interceptor = {
  invoke?: (args: UniArgs) => boolean | void;
  success?: () => void;
  fail?: () => void;
  complete?: () => void;
};

function parseUrl(url = "/") {
  const [pathPart = "/", queryPart = ""] = url.split("?");
  const route = pathPart.replace(/^\//, "");
  const options: Record<string, string> = {};
  queryPart
    .split("&")
    .filter(Boolean)
    .forEach((item) => {
      const [k = "", ...rest] = item.split("=");
      if (!k) return;
      options[decodeURIComponent(k)] = decodeURIComponent(rest.join("="));
    });
  return { route, options };
}

function createUniMock(initialPages: PageLike[]) {
  const pages: PageLike[] = [...initialPages];
  const interceptors = new Map<string, Interceptor>();

  const run = (
    method: "navigateTo" | "redirectTo" | "reLaunch" | "switchTab" | "navigateBack",
    args: UniArgs
  ) => {
    const interceptor = interceptors.get(method);
    const invokeResult = interceptor?.invoke?.(args);
    if (invokeResult === false) return;

    try {
      if (method === "navigateBack") {
        const delta = Math.max(1, args.delta ?? 1);
        if (delta >= pages.length) {
          pages.splice(1);
        } else {
          pages.splice(pages.length - delta, delta);
        }
      } else {
        const { route, options } = parseUrl(args.url);
        const page = { route, options };
        if (method === "navigateTo") {
          pages.push(page);
        } else if (method === "redirectTo") {
          if (pages.length === 0) pages.push(page);
          else pages[pages.length - 1] = page;
        } else if (method === "reLaunch" || method === "switchTab") {
          pages.splice(0, pages.length, page);
        }
      }

      interceptor?.success?.();
      args.success?.({ errMsg: `${method}:ok` });
    } catch (error) {
      interceptor?.fail?.();
      args.fail?.(error);
    } finally {
      interceptor?.complete?.();
      args.complete?.({ errMsg: `${method}:complete` });
    }
  };

  const uni = {
    addInterceptor: vi.fn((method: string, hooks: Interceptor) => {
      interceptors.set(method, hooks);
    }),
    navigateTo: vi.fn((args: UniArgs) => run("navigateTo", args)),
    redirectTo: vi.fn((args: UniArgs) => run("redirectTo", args)),
    reLaunch: vi.fn((args: UniArgs) => run("reLaunch", args)),
    switchTab: vi.fn((args: UniArgs) => run("switchTab", args)),
    navigateBack: vi.fn((args: UniArgs) => run("navigateBack", args))
  };

  return {
    uni,
    pages
  };
}

async function setupModule(initialPages: PageLike[]) {
  vi.resetModules();
  const mock = createUniMock(initialPages);
  (globalThis as any).uni = mock.uni;
  (globalThis as any).getCurrentPages = () => mock.pages;

  const mod = await import("../../src");
  return { ...mod, ...mock };
}

describe("core/manager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps history size when navigating same path with different params", async () => {
    const { setupUniRouter, uni, router } = await setupModule([
      { route: "pages/home", options: {} }
    ]);

    setupUniRouter({ stackSafeLimit: 20, pageHardLimit: 20 });

    uni.navigateTo({ url: "/pages/detail?id=1" });
    uni.navigateTo({ url: "/pages/detail?id=2" });

    const history = router.history.list();
    expect(history).toHaveLength(2);
    expect(history[1].fullPath).toBe("/pages/detail?id=2");
  });

  it("downgrades to redirect and still pushes logical history near limit", async () => {
    const { setupUniRouter, uni, router, pages } = await setupModule([
      { route: "pages/home", options: {} }
    ]);

    setupUniRouter({ stackSafeLimit: 2, pageHardLimit: 5 });

    uni.navigateTo({ url: "/pages/a" });
    uni.navigateTo({ url: "/pages/b" });

    // 物理栈与 native 保持一致(栈深不变),图链记录被换顶的访问链
    const history = router.history.list();
    const graph = router.history.listForGraph();
    expect(history.map((item) => item.path)).toEqual(["/pages/home", "/pages/b"]);
    expect(graph.map((item) => item.path)).toEqual(["/pages/home", "/pages/a", "/pages/b"]);
    expect(pages).toHaveLength(2);
  });

  it("prefers native back and syncs logical history afterwards", async () => {
    const { setupUniRouter, uni, router } = await setupModule([
      { route: "pages/home", options: {} }
    ]);

    setupUniRouter({ stackSafeLimit: 20, pageHardLimit: 20 });

    uni.navigateTo({ url: "/pages/a" });
    uni.navigateTo({ url: "/pages/b" });
    uni.navigateBack({ delta: 1 });

    const history = router.history.list();
    expect(history).toHaveLength(2);
    expect(history[1].path).toBe("/pages/a");
  });

  it("registers interceptors only once", async () => {
    const { setupUniRouter, uni } = await setupModule([{ route: "pages/home", options: {} }]);

    setupUniRouter();
    setupUniRouter();

    expect(uni.addInterceptor).toHaveBeenCalledTimes(5);
  });

  it("navigateBack walks graph chain one step at a time when graph is longer than physical stack", async () => {
    const { setupUniRouter, uni, router, pages } = await setupModule([
      { route: "pages/home", options: {} }
    ]);

    setupUniRouter({ stackSafeLimit: 2, pageHardLimit: 5 });

    uni.navigateTo({ url: "/pages/a" });
    uni.navigateTo({ url: "/pages/b" });
    uni.navigateTo({ url: "/pages/c" });

    // 物理栈被栈顶限制,图链记录所有访问
    const physical = router.history.list();
    const graph = router.history.listForGraph();
    expect(physical).toHaveLength(2);
    expect(graph.length).toBeGreaterThan(physical.length);

    // navigateBack 第一次应通过 redirectTo 回到图链上一页(而非 native back)
    uni.navigateBack({ delta: 1 });

    // 物理栈每步仅回退一层,直到与图链对齐再走 native back
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(uni.redirectTo).toHaveBeenCalled();
  });
});
