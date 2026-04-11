import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "src/**/*.{ts,js,mjs,cjs}": "vp check --fix",
    "vite.config.ts": "vp check --fix",
    "package.json": "vp check --fix",
    "README.md": "vp check --fix"
  },
  pack: {
    dts: {
      tsgo: true
    },
    exports: {
      packageJson: false
    },
    format: ["esm", "cjs"],
    minify: true
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true
    }
  },
  fmt: {
    trailingComma: "none"
  }
});
