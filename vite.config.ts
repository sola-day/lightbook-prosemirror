import { defineConfig } from "vite";

export default defineConfig({
  root: "example",
  server: { port: 5183 },
  build: {
    outDir: "../example-dist",
    emptyOutDir: true,
  },
});
