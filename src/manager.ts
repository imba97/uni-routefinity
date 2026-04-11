import type { RoutefinityOptions, RouteSnapshot } from "./types";
import { renderRouteStackGraph } from "./logger";
import { RouteHistoryStore } from "./store";
import { buildUrl, parsePageInstance, parseUrl } from "./utils";

interface NavigateArgs {
  url: string;
  success?: (result: unknown) => void;
  fail?: (error: unknown) => void;
  complete?: (result: unknown) => void;
}

interface BackArgs {
  delta?: number;
}

type Action =
  | "navigateTo"
  | "navigateToByRedirect"
  | "redirectTo"
  | "navigateBack"
  | "reLaunch"
  | "switchTab"
  | "";

const DEFAULT_OPTIONS: Required<Omit<RoutefinityOptions, "onLog">> = {
  stackSafeLimit: 9,
  debounceMs: 400,
  pageHardLimit: 5,
  protectedPaths: [],
};

const store = new RouteHistoryStore();
let options: Required<Omit<RoutefinityOptions, "onLog">> = { ...DEFAULT_OPTIONS };
let onLog: RoutefinityOptions["onLog"];

let hasInitialized = false;
let isNavigating = false;
let pendingAction: Action = "";
let pendingTargetKey = "";
let pendingUrl = "";
let pendingBackDelta = 1;
let lastNavigateKey = "";
let lastNavigateAt = 0;
let logicalBackTargetIndex = -1;

function emitRouteStackLog() {
  const history = store.list();
  if (!history.length || !onLog) return;
  onLog(renderRouteStackGraph(history), history);
}

function ensureBootstrapped() {
  if (store.size() > 0) return;

  const pages = getCurrentPages();
  if (!pages.length) return;

  pages.forEach((page, index) => {
    const location = parsePageInstance(page);
    if (index === 0) store.resetToRoot(location, "reLaunch");
    else store.push(location, "navigateTo");
  });

  emitRouteStackLog();
}

function clearPending() {
  pendingAction = "";
  pendingTargetKey = "";
  pendingUrl = "";
  pendingBackDelta = 1;
  isNavigating = false;
  logicalBackTargetIndex = -1;
}

function handleNavigateToInvoke(args: NavigateArgs) {
  const url = args.url;
  if (!url) return;

  ensureBootstrapped();

  const target = parseUrl(url);
  const now = Date.now();
  const isFastRepeat = target.key === lastNavigateKey && now - lastNavigateAt < options.debounceMs;
  if (isNavigating || isFastRepeat) return false;

  const current = store.current();
  if (current?.key === target.key) {
    const result = { errMsg: "navigateTo:ok" };
    args.success?.(result);
    args.complete?.(result);
    return false;
  }

  if (current?.path === target.path) {
    isNavigating = true;
    pendingAction = "navigateToByRedirect";
    pendingTargetKey = target.key;
    pendingUrl = url;
    lastNavigateKey = target.key;
    lastNavigateAt = now;
    void uni.redirectTo({ url });
    return false;
  }

  const pages = getCurrentPages();
  if (pages.length >= options.pageHardLimit || pages.length >= options.stackSafeLimit) {
    isNavigating = true;
    pendingAction = "navigateToByRedirect";
    pendingTargetKey = target.key;
    pendingUrl = url;
    lastNavigateKey = target.key;
    lastNavigateAt = now;
    void uni.redirectTo({ url });
    return false;
  }

  isNavigating = true;
  pendingAction = "navigateTo";
  pendingTargetKey = target.key;
  pendingUrl = url;
  lastNavigateKey = target.key;
  lastNavigateAt = now;
}

function handleNavigateToSuccess() {
  if (!pendingUrl || pendingAction !== "navigateTo") return;

  const target = parseUrl(pendingUrl);
  if (pendingTargetKey && pendingTargetKey !== target.key) return;

  store.push(target, "navigateTo");
  emitRouteStackLog();
}

function handleRedirectToSuccess() {
  if (logicalBackTargetIndex >= 0) {
    store.trimToIndex(logicalBackTargetIndex);
    emitRouteStackLog();
    return;
  }

  if (!pendingUrl || (pendingAction !== "redirectTo" && pendingAction !== "navigateToByRedirect"))
    return;

  const target = parseUrl(pendingUrl);
  if (pendingAction === "navigateToByRedirect") {
    store.push(target, "navigateTo");
    emitRouteStackLog();
    return;
  }

  store.replaceCurrent(target, "redirectTo");
  emitRouteStackLog();
}

function handleNavigateBackSuccess() {
  if (pendingAction !== "navigateBack") return;
  store.back(pendingBackDelta);
  emitRouteStackLog();
}

function handleReLaunchSuccess() {
  if (logicalBackTargetIndex >= 0) {
    store.trimToIndex(logicalBackTargetIndex);
    emitRouteStackLog();
    return;
  }

  if (!pendingUrl) return;

  store.resetToRoot(parseUrl(pendingUrl), "reLaunch");
  emitRouteStackLog();
}

function handleSwitchTabSuccess() {
  if (logicalBackTargetIndex >= 0) {
    store.trimToIndex(logicalBackTargetIndex);
    emitRouteStackLog();
    return;
  }

  if (!pendingUrl) return;

  store.resetToRoot(parseUrl(pendingUrl), "switchTab");
  emitRouteStackLog();
}

export function setupRoutefinity(input: RoutefinityOptions = {}) {
  options = { ...DEFAULT_OPTIONS, ...input };
  onLog = input.onLog;

  if (hasInitialized) return;
  hasInitialized = true;

  ensureBootstrapped();

  uni.addInterceptor("navigateTo", {
    invoke(args: NavigateArgs) {
      return handleNavigateToInvoke(args);
    },
    success() {
      handleNavigateToSuccess();
    },
    fail() {
      clearPending();
    },
    complete() {
      clearPending();
    },
  });

  uni.addInterceptor("redirectTo", {
    invoke(args: NavigateArgs) {
      if (pendingAction === "navigateToByRedirect" && pendingUrl === args.url) return;

      if (logicalBackTargetIndex >= 0) return;

      ensureBootstrapped();
      isNavigating = true;
      pendingAction = "redirectTo";
      pendingTargetKey = parseUrl(args.url).key;
      pendingUrl = args.url;
    },
    success() {
      handleRedirectToSuccess();
    },
    fail() {
      clearPending();
    },
    complete() {
      clearPending();
    },
  });

  uni.addInterceptor("navigateBack", {
    invoke(args: BackArgs) {
      ensureBootstrapped();
      const delta = Math.max(1, args?.delta ?? 1);
      const size = store.size();
      if (size <= 1) return;

      const pages = getCurrentPages();
      const nativeMaxDelta = Math.max(0, pages.length - 1);
      if (delta <= nativeMaxDelta) {
        const logicalTargetIndex = Math.max(0, size - 1 - delta);
        const logicalTarget = store.at(logicalTargetIndex);
        const nativeTargetPage = pages[pages.length - 1 - delta];
        const nativeTarget = nativeTargetPage ? parsePageInstance(nativeTargetPage) : undefined;

        if (logicalTarget && nativeTarget && logicalTarget.key === nativeTarget.key) {
          isNavigating = true;
          pendingAction = "navigateBack";
          pendingBackDelta = delta;
          return;
        }
      }

      const targetIndex = Math.max(0, size - 1 - delta);
      const target = store.at(targetIndex);
      if (!target) return;

      logicalBackTargetIndex = targetIndex;
      isNavigating = true;

      if (options.protectedPaths.includes(target.path)) void uni.reLaunch({ url: target.fullPath });
      else void uni.redirectTo({ url: target.fullPath });

      return false;
    },
    success() {
      handleNavigateBackSuccess();
    },
    fail() {
      clearPending();
    },
    complete() {
      clearPending();
    },
  });

  uni.addInterceptor("reLaunch", {
    invoke(args: NavigateArgs) {
      ensureBootstrapped();
      isNavigating = true;
      pendingAction = "reLaunch";
      pendingTargetKey = parseUrl(args.url).key;
      pendingUrl = args.url;
    },
    success() {
      handleReLaunchSuccess();
    },
    fail() {
      clearPending();
    },
    complete() {
      clearPending();
    },
  });

  uni.addInterceptor("switchTab", {
    invoke(args: NavigateArgs) {
      if (logicalBackTargetIndex >= 0) return;

      ensureBootstrapped();
      isNavigating = true;
      pendingAction = "switchTab";
      pendingTargetKey = parseUrl(args.url).key;
      pendingUrl = args.url;
    },
    success() {
      handleSwitchTabSuccess();
    },
    fail() {
      clearPending();
    },
    complete() {
      clearPending();
    },
  });
}

function callRouteMethod(
  method: "navigateTo" | "redirectTo" | "reLaunch" | "switchTab",
  url: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const option = {
      url,
      success: () => resolve(),
      fail: (err: unknown) => reject(err),
    };

    if (method === "navigateTo") {
      uni.navigateTo(option);
      return;
    }
    if (method === "redirectTo") {
      uni.redirectTo(option);
      return;
    }
    if (method === "reLaunch") {
      uni.reLaunch(option);
      return;
    }
    uni.switchTab(option);
  });
}

export const appRouter = {
  navigateTo(url: string, params?: Record<string, unknown>) {
    return callRouteMethod("navigateTo", buildUrl(url, params));
  },
  redirectTo(url: string, params?: Record<string, unknown>) {
    return callRouteMethod("redirectTo", buildUrl(url, params));
  },
  reLaunch(url: string, params?: Record<string, unknown>) {
    return callRouteMethod("reLaunch", buildUrl(url, params));
  },
  switchTab(url: string) {
    return callRouteMethod("switchTab", url);
  },
  navigateBack(delta = 1): Promise<void> {
    return new Promise((resolve) => {
      uni.navigateBack({ delta, success: () => resolve(), fail: () => resolve() });
    });
  },
};

export function getRouteHistory(): RouteSnapshot[] {
  return store.list();
}

export const routeHistory = {
  list: () => store.list(),
  peek: () => store.current(),
  clear: () => store.clear(),
  findLast: (path: string) => store.findLastByPath(path),
};
