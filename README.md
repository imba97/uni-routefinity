# uni-routefinity

A robust routing layer for uni-app mini programs.
It provides a unified navigation API, a logical route history, and predictable fallback behavior when the native page stack is constrained.

## Why This Library

uni-app navigation works with a native page stack that has practical limits. In medium/large apps, this can lead to inconsistent back behavior, repeated detail-page stacking, and hard-to-debug route flows.

`uni-routefinity` addresses this by adding a logical history layer on top of native routing while keeping the original `uni.*` navigation model.

## Features

- Unified Promise-based routing API via `router` and `useRouter()`
- Logical history stack (`list`, `peek`, `findLast`, `clear`)
- Automatic `navigateTo -> redirectTo` downgrade near stack limits
- Native-first back strategy with logical-history synchronization
- Optional route-stack graph logging through `onLog`

## Installation

```bash
pnpm add uni-routefinity
```

## Quick Start

```ts
import { setupUniRouter, useRouter } from "uni-routefinity";

setupUniRouter({
  stackSafeLimit: 9,
  pageHardLimit: 5,
  debounceMs: 400,
  protectedPaths: ["/pages/user/home/index", "/pages/user/mine/index"]
});

const router = useRouter();

await router.navigateTo("/pages-user-course/course-detail/index", {
  course_id: "2037xxxx"
});

await router.navigateBack();
```

## API

### Setup

- `setupUniRouter(policy?: RoutefinityOptions): void`

Notes:

- Idempotent: calling it multiple times only initializes once.
- Should be called during app bootstrap.

### Router Methods

- `router.navigateTo(url: string, params?: Record<string, unknown>): Promise<void>`
- `router.redirectTo(url: string, params?: Record<string, unknown>): Promise<void>`
- `router.reLaunch(url: string, params?: Record<string, unknown>): Promise<void>`
- `router.switchTab(url: string): Promise<void>`
- `router.navigateBack(delta = 1): Promise<void>`

### History Methods

- `router.history.list(): RouteSnapshot[]`
- `router.history.peek(): RouteSnapshot | undefined`
- `router.history.findLast(path: string): RouteSnapshot | undefined`
- `router.history.clear(): void`

## Configuration

`setupUniRouter` accepts `RoutefinityOptions`:

| Field            | Type                       | Default     | Description                                                          |
| ---------------- | -------------------------- | ----------- | -------------------------------------------------------------------- |
| `stackSafeLimit` | `number`                   | `9`         | Soft threshold for switching `navigateTo` to `redirectTo`            |
| `pageHardLimit`  | `number`                   | `5`         | Hard limit threshold for downgrade                                   |
| `debounceMs`     | `number`                   | `400`       | Debounce window for repeated `navigateTo`                            |
| `protectedPaths` | `string[]`                 | `[]`        | Back fallback to these paths uses `reLaunch` instead of `redirectTo` |
| `onLog`          | `(graph, history) => void` | `undefined` | Debug hook for route graph and snapshots                             |

## Routing Strategy

- Duplicate `navigateTo` in a short window is debounced.
- Same path with different params uses `redirectTo` and replaces the logical current entry.
- When native stack depth approaches configured limits, `navigateTo` degrades to `redirectTo`.
- If native and logical stacks diverge, history can be realigned from `getCurrentPages()` before route decisions.
- `navigateBack` prefers native back when target alignment is verified; on success, logical history is synchronized.

## Migration Notes

Current public API:

- `setupUniRouter(...)`
- `router`
- `useRouter()`

Removed legacy exports:

- `setupRoutefinity`
- `appRouter`
- `getRouteHistory`
- `routeHistory`

## Development

```bash
pnpm install
pnpm run check
pnpm run build
```

## License

MIT
