export type RouteAction = "navigateTo" | "redirectTo" | "navigateBack" | "reLaunch" | "switchTab";

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

export interface NavigatePolicy {
  stackSafeLimit?: number;
  debounceMs?: number;
  pageHardLimit?: number;
  protectedPaths?: string[];
}

export type RouteLogHandler = (graph: string, history: RouteSnapshot[]) => void;

export interface RoutefinityOptions extends NavigatePolicy {
  onLog?: RouteLogHandler;
}
