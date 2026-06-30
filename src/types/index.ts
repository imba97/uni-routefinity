export type RouteAction =
  | "navigateTo"
  | "navigateToByRedirect"
  | "redirectTo"
  | "navigateBack"
  | "reLaunch"
  | "switchTab";

export interface RouteLocation {
  path: string;
  query: Record<string, string>;
  fullPath: string;
  key: string;
}

export interface RouteSnapshot extends RouteLocation {
  ts: number;
  action: RouteAction;
}

export interface RouteHistoryOptions {
  /** 逻辑栈最大深度,超过则丢弃最早条目;默认 120 */
  maxDepth?: number;
}

export interface NavigatePolicy {
  stackSafeLimit?: number;
  debounceMs?: number;
  pageHardLimit?: number;
  protectedPaths?: string[];
  autoReconcileOnShow?: boolean;
}

export type RouteLogHandler = (graph: string, history: RouteSnapshot[]) => void;

export interface RoutefinityOptions extends NavigatePolicy {
  onLog?: RouteLogHandler;
}
