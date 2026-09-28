// Bundles test/smoke.ts with esbuild (no DOM needed — it only exercises
// prosemirror-state/-model logic and the markdown pipeline) and runs it.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const outfile = path.join(tmpdir(), `lightbook-prosemirror-smoke-${Date.now()}.mjs`);

await build({
  entryPoints: [path.join(root, "test/smoke.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
});

const result = spawnSync(process.execPath, [outfile], { stdio: "inherit" });
process.exit(result.status ?? 1);
