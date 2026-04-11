import type { RouteLocation, RoutefinityOptions, RouteSnapshot } from "../types";
import { renderRouteStackGraph } from "./logger";
import { RouteHistoryStore } from "./store";
import { buildUrl, parsePageInstance, parseUrl } from "../utils/url";

interface NavigateInvokeArgs {
  url: string;
  success?: (result: unknown) => void;
  fail?: (error: unknown) => void;
  complete?: (result: unknown) => void;
}

interface NavigateBackInvokeArgs {
  delta?: number;
}

type NavigateByRedirectMode = "push" | "replace";
type NavigateToDecision = "noop" | "native" | "replace" | "push";

type PendingState =
  | { kind: "idle" }
  | { kind: "navigateTo"; target: RouteLocation }
  | { kind: "redirectTo"; target: RouteLocation }
  | { kind: "navigateToByRedirect"; target: RouteLocation; mode: NavigateByRedirectMode }
  | { kind: "navigateBackNative" }
  | { kind: "logicalBackFallback"; targetIndex: number }
  | { kind: "reLaunch"; target: RouteLocation }
  | { kind: "switchTab"; target: RouteLocation };

const IDLE_PENDING: PendingState = { kind: "idle" };

const DEFAULT_POLICY: Required<Omit<RoutefinityOptions, "onLog">> = {
  stackSafeLimit: 9,
  debounceMs: 400,
  pageHardLimit: 5,
  protectedPaths: [],
};

class RouteHistoryManager {
  private hasInitialized = false;
  private pending: PendingState = IDLE_PENDING;
  private lastNavigateKey = "";
  private lastNavigateAt = 0;
  private policy: Required<Omit<RoutefinityOptions, "onLog">> = { ...DEFAULT_POLICY };
  private protectedPathSet = new Set<string>();
  private onLog: RoutefinityOptions["onLog"];
  private readonly store = new RouteHistoryStore();

  setup(input: RoutefinityOptions = {}) {
    if (this.hasInitialized) return;

    this.hasInitialized = true;
    this.policy = { ...DEFAULT_POLICY, ...input };
    this.protectedPathSet = new Set(this.policy.protectedPaths);
    this.onLog = input.onLog;

    this.bootstrapFromCurrentPages();
    this.registerInterceptors();
  }

  navigateTo(url: string, params?: Record<string, unknown>) {
    return this.callRouteMethod("navigateTo", buildUrl(url, params));
  }

  redirectTo(url: string, params?: Record<string, unknown>) {
    return this.callRouteMethod("redirectTo", buildUrl(url, params));
  }

  reLaunch(url: string, params?: Record<string, unknown>) {
    return this.callRouteMethod("reLaunch", buildUrl(url, params));
  }

  switchTab(url: string) {
    return this.callRouteMethod("switchTab", url);
  }

  navigateBack(delta = 1): Promise<void> {
    return new Promise((resolve) => {
      uni.navigateBack({
        delta,
        success: () => resolve(),
        fail: () => resolve(),
      });
    });
  }

  listRouteHistory(): RouteSnapshot[] {
    return this.store.list();
  }

  peekRouteHistory() {
    return this.store.current();
  }

  clearRouteHistory() {
    this.store.clear();
  }

  findLastByPath(path: string) {
    return this.store.findLastByPath(path);
  }

  private registerInterceptors() {
    uni.addInterceptor("navigateTo", {
      invoke: (args: NavigateInvokeArgs) => this.handleNavigateToInvoke(args),
      success: () => this.handleNavigateToSuccess(),
      fail: () => this.clearPending(),
      complete: () => this.clearPending(),
    });

    uni.addInterceptor("redirectTo", {
      invoke: (args: NavigateInvokeArgs) => this.handleRedirectInvoke(args),
      success: () => this.handleRedirectSuccess(),
      fail: () => this.clearPending(),
      complete: () => this.clearPending(),
    });

    uni.addInterceptor("navigateBack", {
      invoke: (args: NavigateBackInvokeArgs) => this.handleNavigateBackInvoke(args),
      success: () => this.handleNavigateBackSuccess(),
      fail: () => this.clearPending(),
      complete: () => this.clearPending(),
    });

    uni.addInterceptor("reLaunch", {
      invoke: (args: NavigateInvokeArgs) => this.handleReLaunchInvoke(args),
      success: () => this.handleReLaunchSuccess(),
      fail: () => this.clearPending(),
      complete: () => this.clearPending(),
    });

    uni.addInterceptor("switchTab", {
      invoke: (args: NavigateInvokeArgs) => this.handleSwitchTabInvoke(args),
      success: () => this.handleSwitchTabSuccess(),
      fail: () => this.clearPending(),
      complete: () => this.clearPending(),
    });
  }

  private handleNavigateToInvoke(args: NavigateInvokeArgs) {
    const url = args.url;
    if (!url) return;
    if (this.pending.kind !== "idle") return false;

    const pages = this.bootstrapFromCurrentPages();
    this.alignHistoryWithNativeIfNeeded(pages);

    const target = parseUrl(url);
    const now = Date.now();
    const isFastRepeat =
      target.key === this.lastNavigateKey && now - this.lastNavigateAt < this.policy.debounceMs;

    if (isFastRepeat) return false;

    const current = this.store.current();
    const decision = this.decideNavigateToAction(current, target, pages);
    if (decision === "noop") {
      const result = { errMsg: "navigateTo:ok" };
      args.success?.(result);
      args.complete?.(result);
      return false;
    }

    if (decision === "replace") {
      this.downgradeNavigateTo(target, "replace", now);
      return false;
    }

    if (decision === "push") {
      this.downgradeNavigateTo(target, "push", now);
      return false;
    }
    if (decision !== "native") return false;

    this.pending = { kind: "navigateTo", target };
    this.lastNavigateKey = target.key;
    this.lastNavigateAt = now;
  }

  private handleNavigateToSuccess() {
    if (this.pending.kind !== "navigateTo") return;

    this.store.push(this.pending.target, "navigateTo");
    this.finalizeHistoryUpdate();
  }

  private handleRedirectInvoke(args: NavigateInvokeArgs) {
    if (this.pending.kind !== "idle" && this.pending.kind !== "navigateToByRedirect") return;
    if (this.pending.kind === "navigateToByRedirect" && this.pending.target.fullPath === args.url)
      return;

    const nextTarget = parseUrl(args.url);
    if (this.pending.kind === "navigateToByRedirect") {
      if (this.pending.target.key === nextTarget.key) return;
    }

    this.bootstrapFromCurrentPages();
    this.pending = { kind: "redirectTo", target: nextTarget };
  }

  private handleRedirectSuccess() {
    if (this.applyLogicalBackFallbackIfNeeded()) return;

    if (this.pending.kind === "navigateToByRedirect") {
      if (this.pending.mode === "replace")
        this.store.replaceCurrent(this.pending.target, "navigateTo");
      else this.store.push(this.pending.target, "navigateTo");
      this.finalizeHistoryUpdate();
      return;
    }

    if (this.pending.kind !== "redirectTo") return;
    this.store.replaceCurrent(this.pending.target, "redirectTo");
    this.finalizeHistoryUpdate();
  }

  private handleNavigateBackInvoke(args: NavigateBackInvokeArgs) {
    if (this.pending.kind !== "idle") return false;

    const pages = this.bootstrapFromCurrentPages();

    const delta = Math.max(1, args?.delta ?? 1);
    const historySize = this.store.size();
    if (historySize <= 1) return;

    const nativeMaxDelta = Math.max(0, pages.length - 1);

    if (delta <= nativeMaxDelta) {
      const logicalTargetIndex = Math.max(0, historySize - 1 - delta);
      const logicalTarget = this.store.at(logicalTargetIndex);
      const nativeTargetPage = pages[pages.length - 1 - delta];
      const nativeTarget = nativeTargetPage ? parsePageInstance(nativeTargetPage) : undefined;

      if (logicalTarget && nativeTarget && logicalTarget.key === nativeTarget.key) {
        this.pending = { kind: "navigateBackNative" };
        return;
      }
    }

    const targetIndex = Math.max(0, historySize - 1 - delta);
    const target = this.store.at(targetIndex);
    if (!target) return;

    this.pending = { kind: "logicalBackFallback", targetIndex };

    if (this.protectedPathSet.has(target.path)) void uni.reLaunch({ url: target.fullPath });
    else void uni.redirectTo({ url: target.fullPath });

    return false;
  }

  private handleNavigateBackSuccess() {
    if (this.pending.kind !== "navigateBackNative") return;

    this.syncHistoryFromCurrentPages(true);
    this.finalizeHistoryUpdate();
  }

  private handleReLaunchInvoke(args: NavigateInvokeArgs) {
    this.bootstrapFromCurrentPages();
    this.pending = { kind: "reLaunch", target: parseUrl(args.url) };
  }

  private handleReLaunchSuccess() {
    if (this.applyLogicalBackFallbackIfNeeded()) return;
    if (this.pending.kind !== "reLaunch") return;

    this.store.resetToRoot(this.pending.target, "reLaunch");
    this.finalizeHistoryUpdate();
  }

  private handleSwitchTabInvoke(args: NavigateInvokeArgs) {
    if (this.pending.kind !== "idle") return;

    this.bootstrapFromCurrentPages();
    this.pending = { kind: "switchTab", target: parseUrl(args.url) };
  }

  private handleSwitchTabSuccess() {
    if (this.applyLogicalBackFallbackIfNeeded()) return;
    if (this.pending.kind !== "switchTab") return;

    this.store.resetToRoot(this.pending.target, "switchTab");
    this.finalizeHistoryUpdate();
  }

  private decideNavigateToAction(
    current: RouteSnapshot | undefined,
    target: RouteLocation,
    pages: Page.PageInstance[],
  ): NavigateToDecision {
    if (current?.key === target.key) return "noop";
    if (current?.path === target.path) return "replace";
    if (pages.length >= this.policy.pageHardLimit || pages.length >= this.policy.stackSafeLimit)
      return "push";
    return "native";
  }

  private clearPending() {
    this.pending = IDLE_PENDING;
  }

  private downgradeNavigateTo(
    target: RouteLocation,
    mode: NavigateByRedirectMode,
    timestamp: number,
  ) {
    this.pending = { kind: "navigateToByRedirect", target, mode };
    this.lastNavigateKey = target.key;
    this.lastNavigateAt = timestamp;
    void uni.redirectTo({ url: target.fullPath });
  }

  private applyLogicalBackFallbackIfNeeded() {
    if (this.pending.kind !== "logicalBackFallback") return false;

    this.store.trimToIndex(this.pending.targetIndex);
    this.finalizeHistoryUpdate();
    return true;
  }

  private bootstrapFromCurrentPages(): Page.PageInstance[] {
    const pages = getCurrentPages();
    if (!pages.length) return pages;
    if (this.store.size() > 0) return pages;

    this.rebuildStoreFromPages(pages);
    this.logHistory();
    return pages;
  }

  private alignHistoryWithNativeIfNeeded(pages: Page.PageInstance[]) {
    const nativeCurrentPage = pages[pages.length - 1];
    if (!nativeCurrentPage) return;

    const nativeCurrent = parsePageInstance(nativeCurrentPage);
    const historyCurrent = this.store.current();
    if (!historyCurrent || historyCurrent.key !== nativeCurrent.key) {
      this.syncHistoryFromCurrentPages(true);
    }
  }

  private syncHistoryFromCurrentPages(force = false) {
    const pages = getCurrentPages();
    if (!pages.length) return;

    if (!force && this.store.size() > 0) return;

    this.rebuildStoreFromPages(pages);
  }

  private rebuildStoreFromPages(pages: Page.PageInstance[]) {
    this.store.clear();

    pages.forEach((page, index) => {
      const location = parsePageInstance(page);
      if (index === 0) this.store.resetToRoot(location, "reLaunch");
      else this.store.push(location, "navigateTo");
    });
  }

  private finalizeHistoryUpdate() {
    this.logHistory();
  }

  private logHistory() {
    if (!this.onLog) return;

    const history = this.store.listUnsafe();
    if (!history.length) return;

    this.onLog(renderRouteStackGraph(history), history);
  }

  private callRouteMethod(
    method: "navigateTo" | "redirectTo" | "reLaunch" | "switchTab",
    url: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const options = {
        url,
        success: () => resolve(),
        fail: (err: unknown) => reject(err),
      };
      switch (method) {
        case "navigateTo":
          uni.navigateTo(options);
          return;
        case "redirectTo":
          uni.redirectTo(options);
          return;
        case "reLaunch":
          uni.reLaunch(options);
          return;
        case "switchTab":
          uni.switchTab(options);
          return;
      }
    });
  }
}

const routeHistoryManager = new RouteHistoryManager();

export function setupUniRouter(input: RoutefinityOptions = {}) {
  routeHistoryManager.setup(input);
}

export const router = {
  navigateTo(url: string, params?: Record<string, unknown>) {
    return routeHistoryManager.navigateTo(url, params);
  },
  redirectTo(url: string, params?: Record<string, unknown>) {
    return routeHistoryManager.redirectTo(url, params);
  },
  reLaunch(url: string, params?: Record<string, unknown>) {
    return routeHistoryManager.reLaunch(url, params);
  },
  switchTab(url: string) {
    return routeHistoryManager.switchTab(url);
  },
  navigateBack(delta = 1): Promise<void> {
    return routeHistoryManager.navigateBack(delta);
  },
  history: {
    list: () => routeHistoryManager.listRouteHistory(),
    peek: () => routeHistoryManager.peekRouteHistory(),
    clear: () => routeHistoryManager.clearRouteHistory(),
    findLast: (path: string) => routeHistoryManager.findLastByPath(path),
  },
};

export function useRouter() {
  return router;
}
