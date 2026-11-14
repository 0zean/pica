import type { PackageJson } from "./package-json.ts";

export interface Commands {
  readonly build: readonly string[];
  readonly test: readonly string[];
}

interface CommandInputs {
  readonly paths: ReadonlySet<string>;
  readonly files: ReadonlyMap<string, string>;
  readonly packageJson: PackageJson | undefined;
}

const npmPlaceholderTest = 'echo "Error: no test specified" && exit 1';

export function makeTargets(makefile: string): Set<string> {
  const targets = new Set<string>();
  for (const line of makefile.split("\n")) {
    const match = /^([A-Za-z0-9_.-]+(?:\s+[A-Za-z0-9_.-]+)*)\s*::?(?!=)/.exec(line);
    if (match?.[1] !== undefined) {
      for (const target of match[1].split(/\s+/)) targets.add(target);
    }
  }
  return targets;
}

function packageManager(paths: ReadonlySet<string>): string {
  if (paths.has("pnpm-lock.yaml")) return "pnpm";
  if (paths.has("yarn.lock")) return "yarn";
  if (paths.has("bun.lock") || paths.has("bun.lockb")) return "bun";
  return "npm";
}

function makeCommands(inputs: CommandInputs): Commands {
  const makefile = inputs.files.get("Makefile");
  if (makefile === undefined) return { build: [], test: [] };
  const targets = makeTargets(makefile);
  return {
    build: targets.has("build") ? ["make build"] : [],
    test: targets.has("test") ? ["make test"] : [],
  };
}

function nodeCommands(inputs: CommandInputs): Commands {
  const scripts = inputs.packageJson?.scripts;
  if (scripts === undefined) return { build: [], test: [] };
  const manager = packageManager(inputs.paths);
  const test = scripts.get("test");
  return {
    build: scripts.has("build") ? [`${manager} run build`] : [],
    test: test !== undefined && test !== npmPlaceholderTest ? [`${manager} test`] : [],
  };
}

function usesPytest(inputs: CommandInputs): boolean {
  if (inputs.paths.has("pytest.ini") || inputs.paths.has("conftest.py")) return true;
  return ["pyproject.toml", "setup.cfg", "requirements.txt"].some((path) =>
    /\bpytest\b/.test(inputs.files.get(path) ?? ""),
  );
}

function pythonCommands(inputs: CommandInputs): Commands {
  const pyproject = inputs.files.get("pyproject.toml");
  const isPython =
    pyproject !== undefined || inputs.paths.has("setup.py") || inputs.paths.has("requirements.txt");
  if (!isPython) return { build: [], test: [] };
  const build = pyproject !== undefined && /^\[build-system\]/m.test(pyproject) ? ["python -m build"] : [];
  if (usesPytest(inputs)) return { build, test: ["pytest"] };
  if (inputs.paths.has("tox.ini")) return { build, test: ["tox"] };
  return { build, test: [] };
}

function fixedCommands(inputs: CommandInputs): Commands {
  const has = (path: string): boolean => inputs.paths.has(path);
  const build: string[] = [];
  const test: string[] = [];
  if (has("go.mod")) {
    build.push("go build ./...");
    test.push("go test ./...");
  }
  if (has("Cargo.toml")) {
    build.push("cargo build");
    test.push("cargo test");
  }
  if (has("Package.swift")) {
    build.push("swift build");
    test.push("swift test");
  }
  if (has("pom.xml")) {
    build.push("mvn package");
    test.push("mvn test");
  }
  if (has("build.gradle") || has("build.gradle.kts")) {
    const gradle = has("gradlew") ? "./gradlew" : "gradle";
    build.push(`${gradle} build`);
    test.push(`${gradle} test`);
  }
  return { build, test };
}

// A Makefile is listed first because a repo that has one usually wraps its toolchain in it.
export function detectCommands(inputs: CommandInputs): Commands {
  const all = [makeCommands, nodeCommands, pythonCommands, fixedCommands].map((detect) => detect(inputs));
  return {
    build: [...new Set(all.flatMap((commands) => commands.build))],
    test: [...new Set(all.flatMap((commands) => commands.test))],
  };
}
