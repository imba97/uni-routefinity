import type { RouteLocation, RoutefinityOptions, RouteSnapshot } from "../types";
import { renderRouteStackGraph } from "./logger";
import { routeHistoryStore } from "./store";
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

type NavigateToDecision = "noop" | "native" | "downgrade";

type PendingState =
  | { kind: "idle" }
  | { kind: "navigateTo"; target: RouteLocation }
  | { kind: "redirectTo"; target: RouteLocation }
  | { kind: "navigateToByRedirect"; target: RouteLocation }
  | { kind: "logicalBackFallback"; targetIndex: number }
  | { kind: "reLaunch"; target: RouteLocation }
  | { kind: "switchTab"; target: RouteLocation };

const IDLE_PENDING: PendingState = { kind: "idle" };

const DEFAULT_POLICY: Required<Omit<RoutefinityOptions, "onLog">> = {
  stackSafeLimit: 9,
  debounceMs: 400,
  pageHardLimit: 5,
  protectedPaths: [],
  autoReconcileOnShow: true
};

class RouteHistoryManager {
  private hasInitialized = false;
  private hasInstalledPageOnShowReconcile = false;
  private pending: PendingState = IDLE_PENDING;
  private pendingReconcileReason = "";
  private lastNavigateKey = "";
  private lastNavigateAt = 0;
  private policy: Required<Omit<RoutefinityOptions, "onLog">> = { ...DEFAULT_POLICY };
  private protectedPathSet = new Set<string>();
  private onLog: RoutefinityOptions["onLog"];
  private readonly store = routeHistoryStore;

  setup(input: RoutefinityOptions = {}) {
    if (this.hasInitialized) return;

    this.hasInitialized = true;
    this.policy = { ...DEFAULT_POLICY, ...input };
    this.protectedPathSet = new Set(this.policy.protectedPaths);
    this.onLog = input.onLog;

    this.bootstrapFromCurrentPages();
    setTimeout(() => {
      this.reconcileWithNativePages("setup:postBoot", true);
      this.logHistory();
    }, 0);
    this.registerInterceptors();
    this.installPageOnShowReconcile();
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
        fail: () => resolve()
      });
    });
  }

  reconcileWithNativePages(reason = "manual", force = false): boolean {
    const pages = getCurrentPages();
    if (!pages.length) return false;

    const nativeSnapshots = pages.map((page) => parsePageInstance(page));
    const historySnapshots = this.store.list();
    if (!this.hasStackMismatch(historySnapshots, nativeSnapshots)) return false;

    if (!force && this.pending.kind !== "idle") {
      this.pendingReconcileReason = reason;
      return false;
    }

    const nativeTop = nativeSnapshots[nativeSnapshots.length - 1];
    const historyTop = historySnapshots[historySnapshots.length - 1];

    this.rebuildStoreFromPages(pages);
    this.logReconcileInfo(
      reason,
      nativeSnapshots.length,
      historySnapshots.length,
      nativeTop?.fullPath,
      historyTop?.fullPath
    );
    return true;
  }

  listRouteHistory(): RouteSnapshot[] {
    return this.store.list();
  }

  listRouteHistoryForGraph(): RouteSnapshot[] {
    return this.store.listForGraph();
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
      complete: () => this.clearPending()
    });

    uni.addInterceptor("redirectTo", {
      invoke: (args: NavigateInvokeArgs) => this.handleRedirectInvoke(args),
      success: () => this.handleRedirectSuccess(),
      fail: () => this.clearPending(),
      complete: () => this.clearPending()
    });

    uni.addInterceptor("navigateBack", {
      invoke: (args: NavigateBackInvokeArgs) => this.handleNavigateBackInvoke(args),
      success: () => this.applyLogicalBackFallbackIfNeeded(),
      fail: () => this.clearPending(),
      complete: () => this.clearPending()
    });

    uni.addInterceptor("reLaunch", {
      invoke: (args: NavigateInvokeArgs) => this.handleReLaunchInvoke(args),
      success: () => this.handleReLaunchSuccess(),
      fail: () => this.clearPending(),
      complete: () => this.clearPending()
    });

    uni.addInterceptor("switchTab", {
      invoke: (args: NavigateInvokeArgs) => this.handleSwitchTabInvoke(args),
      success: () => this.handleSwitchTabSuccess(),
      fail: () => this.clearPending(),
      complete: () => this.clearPending()
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

    if (decision === "downgrade") {
      this.downgradeNavigateTo(target, now);
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
    if (this.pending.kind === "logicalBackFallback") return;

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
      // 降级场景下物理栈深不变,store 必须 replaceCurrent 而非 push,否则 deferred-reconcile 会用 native 覆盖导致逻辑帧被丢
      this.store.replaceCurrent(this.pending.target, "navigateToByRedirect");
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
    this.reconcileWithNativePages("navigateBack:invoke");

    const delta = Math.max(1, args?.delta ?? 1);
    const historySize = this.store.size();
    if (historySize <= 1) return;

    const graph = this.store.listForGraph();
    // 图链长于物理栈:被换顶的页不在原生栈里,不能 navigateBack 多格或跳到栈上错误层;每次只回到图链上一页
    if (graph.length > historySize) {
      const prev = graph[graph.length - 2];
      if (!prev) return false;

      if (this.protectedPathSet.has(prev.path)) {
        const keepIdx = this.store.findIndexByKey(prev.key);
        this.pending = { kind: "logicalBackFallback", targetIndex: Math.max(0, keepIdx) };
        void uni.reLaunch({ url: prev.fullPath });
      } else {
        this.store.applyLogicalGraphBack(prev);
        void uni.redirectTo({ url: prev.fullPath });
      }
      return false;
    }

    const nativeMaxDelta = Math.max(0, pages.length - 1);

    if (delta <= nativeMaxDelta) {
      const logicalTargetIndex = Math.max(0, historySize - 1 - delta);
      const logicalTarget = this.store.at(logicalTargetIndex);
      const nativeTargetPage = pages[pages.length - 1 - delta];
      const nativeTarget = nativeTargetPage ? parsePageInstance(nativeTargetPage) : undefined;

      if (logicalTarget && nativeTarget && logicalTarget.key === nativeTarget.key) {
        this.pending = { kind: "logicalBackFallback", targetIndex: logicalTargetIndex };
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
    pages: Page.PageInstance[]
  ): NavigateToDecision {
    if (current?.key === target.key) return "noop";
    if (current?.path === target.path) return "downgrade";
    if (pages.length >= this.policy.pageHardLimit || pages.length >= this.policy.stackSafeLimit)
      return "downgrade";
    return "native";
  }

  private clearPending() {
    const deferredReason = this.pendingReconcileReason;
    this.pending = IDLE_PENDING;
    this.pendingReconcileReason = "";

    if (deferredReason) {
      this.reconcileWithNativePages(`${deferredReason}:afterPending`, true);
      this.logHistory();
    }
  }

  private downgradeNavigateTo(target: RouteLocation, timestamp: number) {
    this.pending = { kind: "navigateToByRedirect", target };
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
      this.rebuildStoreFromPages(getCurrentPages());
    }
  }

  private rebuildStoreFromPages(pages: Page.PageInstance[]) {
    if (!pages.length) return;

    this.store.clear();
    this.store.resetToRoot(parsePageInstance(pages[0]), "reLaunch");
    for (let i = 1; i < pages.length; i++) {
      this.store.push(parsePageInstance(pages[i]), "navigateTo");
    }
  }

  private finalizeHistoryUpdate() {
    // 延后到下个微任务:与 uiron emitRouteStackLogAfterNavigationComplete 一致,
    // 防止 store 同步修改与 reconcile 之间出现时序竞争(deferred-reconcile 用 native 覆盖 store 的 bug 复现)。
    queueMicrotask(() => {
      this.reconcileWithNativePages("finalizeHistoryUpdate");
      this.logHistory();
    });
  }

  private installPageOnShowReconcile() {
    if (!this.policy.autoReconcileOnShow) return;
    if (this.hasInstalledPageOnShowReconcile) return;

    this.hasInstalledPageOnShowReconcile = true;

    const globalScope = globalThis as typeof globalThis & {
      Page?: (options: Record<string, unknown>) => unknown;
      __UNI_ROUTEFINITY_PAGE_PATCHED__?: boolean;
    };

    if (globalScope.__UNI_ROUTEFINITY_PAGE_PATCHED__) return;

    const originPage = globalScope.Page;
    if (typeof originPage !== "function") return;

    const reconcileWithNativePages = this.reconcileWithNativePages.bind(this);

    const patchedPage = ((options: Record<string, unknown>) => {
      if (options && typeof options === "object") {
        const pageOptions = options as Record<string, unknown>;
        const originOnShow = pageOptions.onShow;

        pageOptions.onShow = function routefinityPageOnShow(...args: unknown[]) {
          reconcileWithNativePages("page:onShow");
          if (typeof originOnShow === "function")
            return (originOnShow as (...innerArgs: unknown[]) => unknown).apply(this, args);
        };
      }
      return originPage(options);
    }) as typeof originPage;

    Object.assign(patchedPage, originPage);
    globalScope.Page = patchedPage;
    globalScope.__UNI_ROUTEFINITY_PAGE_PATCHED__ = true;
  }

  private hasStackMismatch(history: RouteSnapshot[], native: RouteLocation[]): boolean {
    if (history.length !== native.length) return true;

    for (let i = 0; i < native.length; i++) {
      const historyItem = history[i];
      const nativeItem = native[i];

      if (!historyItem || !nativeItem) return true;
      if (historyItem.key !== nativeItem.key && historyItem.fullPath !== nativeItem.fullPath)
        return true;
    }

    return false;
  }

  private logHistory() {
    if (!this.onLog) return;

    const history = this.store.listForGraph();
    if (!history.length) return;

    this.onLog(renderRouteStackGraph(history), history);
  }

  private logReconcileInfo(
    reason: string,
    nativeDepth: number,
    historyDepth: number,
    nativeTop?: string,
    historyTop?: string
  ) {
    if (!this.onLog) return;

    this.onLog(
      `[routefinity] 路由栈已自动纠偏\n  reason=${reason}\n  native: ${nativeDepth}层, top=${nativeTop || ""}\n  history: ${historyDepth}层, top=${historyTop || ""}`,
      this.store.listForGraph()
    );
  }

  private callRouteMethod(
    method: "navigateTo" | "redirectTo" | "reLaunch" | "switchTab",
    url: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const options = {
        url,
        success: () => resolve(),
        fail: (err: unknown) => reject(err)
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
  setup(input: RoutefinityOptions = {}) {
    setupUniRouter(input);
  },
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
  reconcileWithNativePages(reason?: string, force?: boolean): boolean {
    return routeHistoryManager.reconcileWithNativePages(reason, force);
  },
  history: {
    list: () => routeHistoryManager.listRouteHistory(),
    listForGraph: () => routeHistoryManager.listRouteHistoryForGraph(),
    peek: () => routeHistoryManager.peekRouteHistory(),
    clear: () => routeHistoryManager.clearRouteHistory(),
    findLast: (path: string) => routeHistoryManager.findLastByPath(path),
    reconcile: (reason?: string, force?: boolean): boolean =>
      routeHistoryManager.reconcileWithNativePages(reason, force)
  }
};

export function useRouter() {
  return router;
}
