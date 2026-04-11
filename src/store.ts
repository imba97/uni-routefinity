import type { RouteAction, RouteLocation, RouteSnapshot } from "./types";

const DEFAULT_MAX_DEPTH = 500;

export class RouteHistoryStore {
  private stack: RouteSnapshot[] = [];

  list(): RouteSnapshot[] {
    return [...this.stack];
  }

  listUnsafe(): RouteSnapshot[] {
    return this.stack;
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
    this.stack.length = 0;
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
  }

  replaceCurrent(location: RouteLocation, action: RouteAction) {
    if (!this.stack.length) {
      this.resetToRoot(location, action);
      return;
    }
    this.stack[this.stack.length - 1] = this.toSnapshot(location, action);
  }

  resetToRoot(location: RouteLocation, action: RouteAction) {
    const snapshot = this.toSnapshot(location, action);
    if (this.stack.length === 0) {
      this.stack.push(snapshot);
      return;
    }
    this.stack[0] = snapshot;
    this.stack.length = 1;
  }

  back(delta = 1) {
    if (!this.stack.length) return;

    const safeDelta = Math.max(1, delta);
    if (safeDelta >= this.stack.length) {
      this.stack.length = 1;
      return;
    }

    this.stack.splice(this.stack.length - safeDelta, safeDelta);
  }

  trimToIndex(index: number) {
    if (index < 0 || index >= this.stack.length) return;
    this.stack.splice(index + 1);
  }

  private toSnapshot(location: RouteLocation, action: RouteAction): RouteSnapshot {
    return { ...location, action, ts: Date.now() };
  }
}
