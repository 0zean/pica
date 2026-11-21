// H-06: bundles `picad` into one ES module for the app (docs/distribution.md). Usage:
//   node tools/bundle/main.ts --out <dir> --version <x.y.z>
// Writes <dir>/picad.mjs and <dir>/builtin/ (the built-in agents, read next to the bundle at run time).
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { build, type Plugin } from "esbuild";
import { bundleInputs } from "./paths.ts";

const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

function versionPlugin(version: string): Plugin {
  return {
    name: "pica-engine-version",
    setup(context) {
      context.onLoad({ filter: /[\\/]server[\\/]src[\\/]version\.ts$/ }, () => ({
        contents: `export const ENGINE_VERSION = ${JSON.stringify(version)};\n`,
        loader: "ts",
      }));
    },
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: "string" }, version: { type: "string" } } });
  const out = values.out;
  const version = values.version;
  if (out === undefined || version === undefined || !VERSION_PATTERN.test(version)) {
    throw new Error("usage: bundle --out <dir> --version <x.y.z>");
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: [bundleInputs.entry],
    outfile: join(out, "picad.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // jsonc-parser's `main` is a UMD build whose requires esbuild cannot follow; its `module` build is plain ESM.
    mainFields: ["module", "main"],
    legalComments: "none",
    logLevel: "warning",
    plugins: [versionPlugin(version)],
    // The SDK and its dependencies are CommonJS in places; ESM output needs `require` for them.
    banner: { js: 'import { createRequire as __picaRequire } from "node:module"; const require = __picaRequire(import.meta.url);' },
  });
  cpSync(bundleInputs.builtinAgents, join(out, "builtin"), { recursive: true });
  console.log(`bundled picad ${version} into ${out}`);
}

await main();
