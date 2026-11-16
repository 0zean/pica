import { isDeepStrictEqual } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fail, isRecord, pass, readJson } from "../check-helpers.ts";
import { servicePorts } from "../generated-modules.ts";
import type { EvalTask } from "./task.ts";

function writeJson(workdir: string, path: string, value: unknown): void {
  mkdirSync(dirname(join(workdir, path)), { recursive: true });
  writeFileSync(join(workdir, path), `${JSON.stringify(value, null, 2)}\n`);
}

function jsonObject(workdir: string, path: string): Record<string, unknown> | undefined {
  const value = readJson(workdir, path);
  return isRecord(value) ? value : undefined;
}

function lower(value: unknown): unknown {
  return typeof value === "string" ? value.toLowerCase() : value;
}

const ports = servicePorts();

// Config generation: a new config file whose required settings a parser can check.
export const configTasks: readonly EvalTask[] = [
  {
    id: "tsconfig",
    category: "config-generation",
    repo: "web-toolkit",
    prompt:
      'Create tsconfig.json for type-checking the JavaScript in src/: compilerOptions with "strict": true, "checkJs": true, ' +
      '"allowJs": true, "noEmit": true, "target": "ES2022", "module": "NodeNext"; and "include": ["src"].',
    check: ({ workdir }) => {
      const config = jsonObject(workdir, "tsconfig.json");
      if (config === undefined) return fail("tsconfig.json is missing or is not a JSON object");
      const options = config["compilerOptions"];
      if (!isRecord(options)) return fail("tsconfig.json has no compilerOptions");
      const wanted: [string, unknown][] = [["strict", true], ["checkJs", true], ["allowJs", true], ["noEmit", true], ["target", "es2022"], ["module", "nodenext"]];
      const wrong = wanted.filter(([key, value]) => lower(options[key]) !== value).map(([key]) => key);
      if (wrong.length > 0) return fail(`tsconfig.json compilerOptions wrong or missing: ${wrong.join(", ")}`);
      const include = config["include"];
      return Array.isArray(include) && include.some((entry) => entry === "src" || entry === "src/" || entry === "src/**/*")
        ? pass("tsconfig.json has the required options and includes src")
        : fail("tsconfig.json does not include src");
    },
    solve: (workdir) => {
      writeJson(workdir, "tsconfig.json", {
        compilerOptions: { strict: true, checkJs: true, allowJs: true, noEmit: true, target: "ES2022", module: "NodeNext" },
        include: ["src"],
      });
      return "Created tsconfig.json.";
    },
  },
  {
    id: "prettier-config",
    category: "config-generation",
    repo: "web-toolkit",
    prompt:
      "Create .prettierrc.json matching the style of the code in src/: double quotes, semicolons, two-space indent, " +
      "trailing commas everywhere, and a print width of 120.",
    check: ({ workdir }) => {
      const config = jsonObject(workdir, ".prettierrc.json");
      if (config === undefined) return fail(".prettierrc.json is missing or is not a JSON object");
      const wanted: [string, unknown, unknown][] = [
        ["singleQuote", false, undefined],
        ["semi", true, undefined],
        ["tabWidth", 2, undefined],
        ["trailingComma", "all", undefined],
        ["printWidth", 120, 120],
      ];
      // A key left at Prettier's default counts, except printWidth, whose default is 80.
      const wrong = wanted
        .filter(([key, value, required]) => (config[key] === undefined ? required !== undefined : config[key] !== value))
        .map(([key]) => key);
      if (config["useTabs"] === true) wrong.push("useTabs");
      return wrong.length === 0 ? pass(".prettierrc.json matches the code style") : fail(`.prettierrc.json wrong: ${wrong.join(", ")}`);
    },
    solve: (workdir) => {
      writeJson(workdir, ".prettierrc.json", { singleQuote: false, semi: true, tabWidth: 2, trailingComma: "all", printWidth: 120 });
      return "Created .prettierrc.json.";
    },
  },
  {
    id: "service-ports",
    category: "config-generation",
    repo: "web-toolkit",
    prompt:
      "Create config/ports.json from the table in docs/services.md: one JSON object mapping each service name to its " +
      "port as a number, and nothing else.",
    check: ({ workdir }) => {
      const value = readJson(workdir, "config/ports.json");
      if (isDeepStrictEqual(value, ports)) return pass("config/ports.json maps every service to its port");
      if (!isRecord(value)) return fail("config/ports.json is missing or is not a JSON object");
      const wrong = Object.keys({ ...ports, ...value }).filter((service) => value[service] !== ports[service]);
      return fail(`config/ports.json is wrong for ${String(wrong.length)} services, such as ${wrong.slice(0, 3).join(", ")}`);
    },
    solve: (workdir) => {
      writeJson(workdir, "config/ports.json", ports);
      return "Created config/ports.json.";
    },
  },
];
