import { defineConfig } from "vite";

export default defineConfig({
  root: "example",
  server: { port: 5183 },
  build: {
    outDir: "../example-dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      // loro-crdt's default entry uses the WASM ESM-integration proposal
      // ("import ... from *.wasm"), which neither Vite's esbuild-based dev
      // server nor a plain Rollup build understands without extra plugins.
      // The `/base64` entry inlines the wasm as a base64 string instead —
      // no special loader needed, works identically in dev and build. Alias
      // the bare package name so this also covers loro-prosemirror's own
      // (unaliasable) `import ... from "loro-crdt"`.
      "loro-crdt": "loro-crdt/base64",
    },
  },
});
