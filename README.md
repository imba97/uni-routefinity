# uni-routefinity

`uni-routefinity` is a routing helper for uni-app:

- Infinite logical history (business history keeps growing)
- Bounded real page stack (prevents webview stack pressure)
- Smart back behavior
- Optional route stack graph logger

## Toolchain

This library uses [Vite+](https://github.com/voidzero-dev/vite-plus) as the unified toolchain.

- Build: `vp pack`
- Check (lint + type): `vp check`
- Configure hooks/staged checks: `vp config`

## Basic Usage

```ts
import { setupRoutefinity, appRouter } from "uni-routefinity";

setupRoutefinity({
  pageHardLimit: 5,
  onLog: (graph) => console.log(graph),
});

appRouter.navigateTo("/pages-user-store/detail/index", { store_id: "123" });
```
