import type { RouteAction, RouteLocation, RouteSnapshot } from "./types";

const DEFAULT_MAX_DEPTH = 500;

export class RouteHistoryStore {
  private stack: RouteSnapshot[] = [];
  private keyToLastIndex = new Map<string, number>();

  list(): RouteSnapshot[] {
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
    this.keyToLastIndex.clear();
  }

  findLastByPath(path: string): RouteSnapshot | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      if (this.stack[i].path === path) return this.stack[i];
    }
    return undefined;
  }

  push(location: RouteLocation, action: RouteAction) {
    const current = this.current();
    if (current?.key === location.key) return;

    this.stack.push(this.toSnapshot(location, action));
    if (this.stack.length > DEFAULT_MAX_DEPTH)
      this.stack.splice(0, this.stack.length - DEFAULT_MAX_DEPTH);
    this.rebuildIndex();
  }

  replaceCurrent(location: RouteLocation, action: RouteAction) {
    if (!this.stack.length) {
      this.resetToRoot(location, action);
      return;
    }
    this.stack[this.stack.length - 1] = this.toSnapshot(location, action);
    this.rebuildIndex();
  }

  resetToRoot(location: RouteLocation, action: RouteAction) {
    this.stack = [this.toSnapshot(location, action)];
    this.rebuildIndex();
  }

  back(delta = 1) {
    if (!this.stack.length) return;

    const safeDelta = Math.max(1, delta);
    if (safeDelta >= this.stack.length) {
      this.stack = [this.stack[0]];
      this.rebuildIndex();
      return;
    }

    this.stack.splice(this.stack.length - safeDelta, safeDelta);
    this.rebuildIndex();
  }

  trimToIndex(index: number) {
    if (index < 0 || index >= this.stack.length) return;
    this.stack.splice(index + 1);
    this.rebuildIndex();
  }

  private toSnapshot(location: RouteLocation, action: RouteAction): RouteSnapshot {
    return { ...location, action, ts: Date.now() };
  }

  private rebuildIndex() {
    this.keyToLastIndex.clear();
    this.stack.forEach((item, index) => this.keyToLastIndex.set(item.key, index));
  }
}
