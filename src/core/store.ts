import type { RouteAction, RouteHistoryOptions, RouteLocation, RouteSnapshot } from "../types";

const DEFAULT_MAX_DEPTH = 120;

class RouteHistoryStore {
  private stack: RouteSnapshot[] = [];
  /** 与 stack 同步;仅在 navigateToByRedirect 时额外 push,用于路由图展示「超过物理槽」的访问链 */
  private graphStack: RouteSnapshot[] = [];
  private keyToLastIndex = new Map<string, number>();
  private readonly maxDepth: number;

  constructor(options: RouteHistoryOptions = {}) {
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  list(): RouteSnapshot[] {
    return [...this.stack];
  }

  /** 供调试路由图:在硬上限下多次 redirect 换顶时可能比 list() 更长 */
  listForGraph(): RouteSnapshot[] {
    if (this.graphStack.length > this.stack.length) return [...this.graphStack];
    return [...this.stack];
  }

  current(): RouteSnapshot | undefined {
    return this.stack[this.stack.length - 1];
  }

  at(index: number): RouteSnapshot | undefined {
    return this.stack[index];
  }

  size(): number {
    return this.stack.length;
  }

  clear() {
    this.stack = [];
    this.graphStack = [];
    this.keyToLastIndex.clear();
  }

  findIndexByKey(key: string): number {
    const index = this.keyToLastIndex.get(key);
    return index === undefined ? -1 : index;
  }

  findLastByPath(path: string): RouteSnapshot | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].path === path) return this.stack[i];
    }
    return undefined;
  }

  resetToRoot(location: RouteLocation, action: RouteAction) {
    const snap = this.toSnapshot(location, action);
    this.stack = [snap];
    this.graphStack = [snap];
    this.keyToLastIndex.clear();
    this.keyToLastIndex.set(snap.key, 0);
  }

  replaceCurrent(location: RouteLocation, action: RouteAction) {
    if (this.stack.length === 0) {
      this.resetToRoot(location, action);
      return;
    }

    const snap = this.toSnapshot(
      location,
      action === "navigateToByRedirect" ? "navigateTo" : action
    );

    if (action === "navigateToByRedirect") {
      const prevTop = this.stack[this.stack.length - 1];
      this.stack[this.stack.length - 1] = snap;
      if (prevTop.key !== snap.key) this.graphStack.push(snap);
      else if (this.graphStack.length) this.graphStack[this.graphStack.length - 1] = snap;
      this.trimGraphStackDepth();
    } else {
      this.stack[this.stack.length - 1] = snap;
      if (this.graphStack.length) this.graphStack[this.graphStack.length - 1] = snap;
      else this.graphStack = [...this.stack];
    }

    this.keyToLastIndex.set(snap.key, this.stack.length - 1);
  }

  push(location: RouteLocation, action: RouteAction) {
    const current = this.current();
    if (current?.key === location.key) return;

    const snap = this.toSnapshot(location, action);
    this.stack.push(snap);
    this.graphStack.push(snap);

    if (this.stack.length > this.maxDepth) {
      const drop = this.stack.length - this.maxDepth;
      this.stack.splice(0, drop);
      this.graphStack.splice(0, Math.min(drop, this.graphStack.length));
    }
    this.trimGraphStackDepth();

    this.keyToLastIndex.set(snap.key, this.stack.length - 1);
  }

  back(delta = 1) {
    if (this.stack.length === 0) return;

    const safeDelta = Math.max(1, delta);
    if (safeDelta >= this.stack.length) {
      this.stack = [this.stack[0]];
      this.graphStack = [...this.stack];
      this.rebuildIndex();
      return;
    }

    this.stack.splice(this.stack.length - safeDelta, safeDelta);
    this.graphStack = [...this.stack];
    this.rebuildIndex();
  }

  trimToIndex(index: number) {
    if (index < 0 || index >= this.stack.length) return;
    this.stack.splice(index + 1);
    this.graphStack = [...this.stack];
    this.rebuildIndex();
  }

  /**
   * 图链兜底回退(物理栈被栈顶限制时使用):先把图链顶(当前页)从图链 pop 掉,
   * 再把物理栈顶与图链顶都替换为目标 location,使两栈在目标页对齐。
   */
  applyLogicalGraphBack(location: RouteLocation) {
    const snap = this.toSnapshot(location, "redirectTo");
    if (this.graphStack.length > this.stack.length) this.graphStack.pop();

    if (this.stack.length === 0) {
      this.stack = [snap];
      this.graphStack = [snap];
    } else {
      this.stack[this.stack.length - 1] = snap;
      if (this.graphStack.length) this.graphStack[this.graphStack.length - 1] = snap;
      else this.graphStack = [...this.stack];
    }
    this.keyToLastIndex.set(snap.key, this.stack.length - 1);
  }

  /** graphStack 与 stack 底对齐裁剪,避免无限涨 */
  private trimGraphStackDepth() {
    if (this.graphStack.length <= this.maxDepth) return;
    const drop = this.graphStack.length - this.maxDepth;
    this.graphStack.splice(0, drop);
  }

  private toSnapshot(location: RouteLocation, action: RouteAction): RouteSnapshot {
    return { ...location, action, ts: Date.now() };
  }

  /** 仅在 back/trimToIndex 等会截短栈的路径使用,因为被截掉的 key 索引无法增量更新 */
  private rebuildIndex() {
    this.keyToLastIndex.clear();
    this.stack.forEach((item, index) => {
      this.keyToLastIndex.set(item.key, index);
    });
  }
}

export { RouteHistoryStore };
export const routeHistoryStore = new RouteHistoryStore();
