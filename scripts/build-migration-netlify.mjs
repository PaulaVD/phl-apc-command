import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = path.join(root, "apps/migration-command");
const outFile = path.join(root, "legacy/apc-console/migration/migration-ui.bundle.js");

await esbuild.build({
  absWorkingDir: appRoot,
  entryPoints: [path.join(appRoot, "netlify-entry.tsx")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outfile: outFile,
  alias: {
    "@": appRoot
  },
  loader: {
    ".json": "json"
  },
  define: {
    "process.env.NODE_ENV": '"production"'
  },
  logLevel: "info"
});

console.log("Wrote", outFile);
