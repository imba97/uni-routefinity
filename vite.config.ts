import { defineConfig } from "vite-plus";

const IGNORE_PATTERNS = ["node_modules/**", ".pnpm/**", "dist/**", ".vite-hooks/**", "*.d.ts"];

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    dts: {
      tsgo: true,
    },
    exports: {
      packageJson: false,
    },
    format: ["esm", "cjs"],
    minify: true,
  },
  lint: {
    ignorePatterns: IGNORE_PATTERNS,
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: IGNORE_PATTERNS,
    options: {
      trailingComma: "none",
    },
  },
});
