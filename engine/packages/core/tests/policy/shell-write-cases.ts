import { auto, routing, shell, withResult } from "./cases.ts";
import type { Case } from "./cases.ts";
import { referenceRoot, toolCall, writeRoot } from "./fixtures.ts";

// C-04 follow-up: under `balanced` and `strict`, a main-agent shell command that writes a file inside
// the write roots is denied naming code-writer, as the main agent has no create tool (PLAN.md §5.4).
const strictAuto = routing({ profile: "strict" }, { mode: "auto" });
const offAuto = routing({ profile: "off" }, { mode: "auto" });
const denied = { outcome: "deny", ruleId: "cost.shell-write" } as const;
const allowed = { outcome: "allow", ruleId: "permission.auto" } as const;

export const shellWriteBlockedCases: Case[] = [
  { name: "a redirect", call: toolCall(shell("echo hi > notes.txt")), context: auto, ...denied },
  { name: "an appending redirect", call: toolCall(shell("npm test >> logs/out.log")), context: auto, ...denied },
  { name: "a heredoc into a file", call: toolCall(shell("cat > test/money.test.mjs <<'EOF'\nimport { test } from \"node:test\";\nEOF")), context: auto, ...denied },
  { name: "a heredoc before its redirect", call: toolCall(shell("cat <<EOF > config/ports.json\n{}\nEOF")), context: auto, ...denied },
  { name: "an absolute target", call: toolCall(shell(`printf '{}' > ${writeRoot}/tsconfig.json`)), context: auto, ...denied },
  { name: "stdout and stderr to a file", call: toolCall(shell("make &> build.log")), context: auto, ...denied },
  { name: "tee", call: toolCall(shell("make | tee build.log")), context: auto, ...denied },
  { name: "tee -a", call: toolCall(shell("echo x | tee -a a.txt b.txt")), context: auto, ...denied },
  { name: "touch", call: toolCall(shell("touch src/new.mjs")), context: auto, ...denied },
  { name: "a cp destination", call: toolCall(shell("cp src/a.mjs src/b.mjs")), context: auto, ...denied },
  { name: "an mv destination", call: toolCall(shell("mv -f build/x ./y")), context: auto, ...denied },
  { name: "an install destination", call: toolCall(shell("install -m 644 a.txt dest/a.txt")), context: auto, ...denied },
  { name: "a write after cd inside the root", call: toolCall(shell("cd src && echo x > a.mjs")), context: auto, ...denied },
  { name: "a write in the second command", call: toolCall(shell("ls; echo x > a.txt")), context: auto, ...denied },
  { name: "a redirect under strict", call: toolCall(shell("echo hi > notes.txt")), context: strictAuto, ...denied },
  { name: "a redirect in ask mode is denied, not asked", call: toolCall(shell("echo hi > notes.txt")), ...denied },
];

export const shellWritePassedCases: Case[] = [
  { name: "a read-only command", call: toolCall(shell("grep -n fmtCents src/*.mjs")), context: auto, ...allowed },
  { name: "running the tests", call: toolCall(shell("node --test test/")), context: auto, ...allowed },
  { name: "a pipe with no file target", call: toolCall(shell("cat package.json | wc -l")), context: auto, ...allowed },
  { name: "output to /dev/null", call: toolCall(shell("npm test > /dev/null 2>&1")), context: auto, ...allowed },
  { name: "stderr onto stdout", call: toolCall(shell("npm test 2>&1 | tail -5")), context: auto, ...allowed },
  { name: "a > inside quotes", call: toolCall(shell("echo 'a > b'")), context: auto, ...allowed },
  { name: "a heredoc into a command", call: toolCall(shell("node --input-type=module <<'EOF'\nconsole.log(1)\nEOF")), context: auto, ...allowed },
  { name: "an interpreter that writes is not classified", call: toolCall(shell("node -e \"require('fs').writeFileSync('x', '')\"")), context: auto, ...allowed },
  { name: "sed -i edits in place, as edit does", call: toolCall(shell("sed -i '' s/a/b/ src/a.mjs")), context: auto, ...allowed },
  { name: "a write by a sub-agent", call: toolCall(shell("echo hi > notes.txt"), { agent: "code-writer" }), context: auto, ...allowed },
  { name: "a redirect under off", call: toolCall(shell("echo hi > notes.txt")), context: offAuto, ...allowed },
  { name: "a cp with no operands writes nothing", call: toolCall(shell("cp")), context: auto, ...allowed },
  { name: "a cp under off", call: toolCall(shell("cp src/a.mjs src/b.mjs")), context: offAuto, ...allowed },
  { name: "a result is not gated again", call: withResult(shell("echo hi > notes.txt"), 10), context: auto, outcome: "allow", ruleId: "permission.result" },
];

export const shellWriteScopeCases: Case[] = [
  { name: "a redirect outside the write roots", call: toolCall(shell(`echo x > ${referenceRoot}/a`)), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "a redirect to a variable", call: toolCall(shell("echo x > $OUT")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
];
