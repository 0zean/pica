import type { PolicyContext } from "../../src/index.ts";
import { auto, shell, smallRead, write, type Case } from "./cases.ts";
import { referenceRoot, toolCall, writeRoot } from "./fixtures.ts";

const links = (entries: Record<string, string>): Partial<PolicyContext> => ({ realPaths: new Map(Object.entries(entries)) });

// Write and reference roots on every path a call names, with symlinks resolved by the sandbox.
export const scopeCases: Case[] = [
  { name: "a write to a reference root is denied", call: toolCall(write(`${referenceRoot}/src/a.ts`)), outcome: "deny", ruleId: "safety.outside-write-roots" },
  { name: "a write to a reference root is denied in auto mode", call: toolCall(write(`${referenceRoot}/a.ts`)), context: auto, outcome: "deny", ruleId: "safety.outside-write-roots" },
  { name: "a relative write climbing into a reference root is denied", call: toolCall(write("../../ref/lib/a.ts")), outcome: "deny", ruleId: "safety.outside-write-roots" },
  { name: "a write climbing out of every root with .. is denied", call: toolCall(write(`${writeRoot}/src/../../../etc/hosts`)), outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "a read climbing out of a reference root with .. is denied", call: toolCall(smallRead(`${referenceRoot}/../../etc/passwd`)), outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "a write through a symlink leaving every root is denied", call: toolCall(write(`${writeRoot}/link/hosts`)), context: links({ [`${writeRoot}/link/hosts`]: "/etc/hosts" }), outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "a read through a symlink leaving every root is denied", call: toolCall(smallRead("link/passwd")), context: { ...auto, ...links({ [`${writeRoot}/link/passwd`]: "/etc/passwd" }) }, outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "a write through a symlink into a reference root is denied", call: toolCall(write(`${writeRoot}/vendor/a.ts`)), context: links({ [`${writeRoot}/vendor/a.ts`]: `${referenceRoot}/a.ts` }), outcome: "deny", ruleId: "safety.outside-write-roots" },
  { name: "a symlink then .. is judged where it really lands", call: toolCall(write(`${writeRoot}/link/../x`)), context: links({ [`${writeRoot}/link/../x`]: "/etc/x" }), outcome: "deny", ruleId: "safety.outside-roots" },
  { name: "a symlink inside the write root stays allowed", call: toolCall(write(`${writeRoot}/current/a.ts`)), context: { ...auto, ...links({ [`${writeRoot}/current/a.ts`]: `${writeRoot}/v2/a.ts` }) }, outcome: "allow", ruleId: "permission.auto" },
  { name: "a path outside the roots that resolves inside them is allowed", call: toolCall(smallRead("/var/repo/a.ts")), context: links({ "/var/repo/a.ts": `${writeRoot}/a.ts` }), outcome: "allow", ruleId: "permission.read-only" },
  { name: "roots are compared by their real paths too", call: toolCall(write("/private/work/repo/a.ts")), context: { ...auto, ...links({ [writeRoot]: "/private/work/repo" }) }, outcome: "allow", ruleId: "permission.auto" },
  { name: "a write root behind a symlink still contains its lexical paths", call: toolCall(write(`${writeRoot}/a.ts`)), context: { ...auto, ...links({ [writeRoot]: "/private/work/repo", [`${writeRoot}/a.ts`]: "/private/work/repo/a.ts" }) }, outcome: "allow", ruleId: "permission.auto" },
  { name: "a search with one path escaping through a symlink is denied", call: toolCall({ kind: "search", paths: [writeRoot, `${referenceRoot}/out`] }), context: links({ [`${referenceRoot}/out`]: "/Users/someone" }), outcome: "deny", ruleId: "safety.outside-roots" },
];

// The shell's working directory, `cd` targets, redirects and `tee` files against the write roots.
export const shellScopeCases: Case[] = [
  { name: "a redirect inside the write root reaches permission mode", call: toolCall(shell("npm test > out.log 2>&1")), outcome: "ask", ruleId: "permission.ask" },
  { name: "a redirect inside the write root is allowed in auto mode", call: toolCall(shell("npm test >> logs/out.log")), context: auto, outcome: "allow", ruleId: "permission.auto" },
  { name: "a redirect outside the write roots asks", call: toolCall(shell("echo x > /etc/motd")), outcome: "ask", ruleId: "safety.shell-outside-write-roots" },
  { name: "a redirect outside the write roots is denied in auto mode", call: toolCall(shell("echo x > /etc/motd")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "a redirect into a reference root is denied in auto mode", call: toolCall(shell("echo x >../../ref/lib/a.ts")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "an append redirect with a file descriptor is checked", call: toolCall(shell("make 2>>/tmp/err.log")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "&> is a redirect", call: toolCall(shell("make &>/tmp/all.log")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: ">| is a redirect", call: toolCall(shell("make >|/tmp/all.log")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: ">& with a file name is a redirect", call: toolCall(shell("make >& /tmp/all.log")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "descriptor duplication is not a write", call: toolCall(shell("make 2>&1 >&- 1>&2")), context: auto, outcome: "allow", ruleId: "permission.auto" },
  { name: "/dev/null is not outside", call: toolCall(shell("make > /dev/null 2>/dev/stderr")), context: auto, outcome: "allow", ruleId: "permission.auto" },
  { name: "a quoted redirect target is still checked", call: toolCall(shell("echo x > '/tmp/a b'")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "a quoted > is not a redirect", call: toolCall(shell("echo 'a > /etc/motd' \"b > /etc/x\" c\\>/tmp/y")), context: auto, outcome: "allow", ruleId: "permission.auto" },
  { name: "a quoted digit before > is an argument, not a descriptor", call: toolCall(shell("echo '2'>/tmp/x")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "a redirect target with a variable cannot be resolved", call: toolCall(shell("echo x > $HOME/a")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "a double-quoted variable cannot be resolved", call: toolCall(shell('echo x > "$OUT"')), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "a redirect target under ~ cannot be resolved", call: toolCall(shell("echo x > ~/a")), outcome: "ask", ruleId: "safety.shell-outside-write-roots" },
  { name: "a quoted ~ is a literal directory name", call: toolCall(shell("echo x > '~'/a")), context: auto, outcome: "allow", ruleId: "permission.auto" },
  { name: "an unterminated quote runs to the end of the command", call: toolCall(shell("echo x > 'out.log")), context: auto, outcome: "allow", ruleId: "permission.auto" },
  { name: "a redirect with no target is ignored", call: toolCall(shell("echo x >")), context: auto, outcome: "allow", ruleId: "permission.auto" },
  { name: "a redirect followed by a separator is ignored", call: toolCall(shell("echo x > ; ls")), context: auto, outcome: "allow", ruleId: "permission.auto" },
  { name: "tee writes its file arguments", call: toolCall(shell("make | tee -a build.log /etc/build.log")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "tee inside the write root is allowed", call: toolCall(shell("make | tee build.log")), context: auto, outcome: "allow", ruleId: "permission.auto" },
  { name: "cd outside the write roots asks", call: toolCall(shell("cd /tmp && ls")), outcome: "ask", ruleId: "safety.shell-outside-write-roots" },
  { name: "cd outside the write roots is denied in auto mode", call: toolCall(shell("cd /tmp; ls")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "pushd into a reference root asks", call: toolCall(shell("pushd -q ../../ref/lib")), outcome: "ask", ruleId: "safety.shell-outside-write-roots" },
  { name: "cd within the write root is allowed", call: toolCall(shell("cd src && cd ../test && npm test")), context: auto, outcome: "allow", ruleId: "permission.auto" },
  { name: "a redirect after cd resolves from the new directory", call: toolCall(shell("cd .. && echo x > a.txt")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "a redirect on the cd itself resolves from the old directory", call: toolCall(shell("cd .. > out.log")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "cd with no argument goes home, which cannot be resolved", call: toolCall(shell("cd")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "cd - cannot be resolved", call: toolCall(shell("cd - && ls")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "after an unknown cd, relative redirects cannot be resolved", call: toolCall(shell("cd \"$D\" ; echo > a")), outcome: "ask", ruleId: "safety.shell-outside-write-roots" },
  { name: "after an unknown cd, an absolute redirect is still judged", call: toolCall(shell(`cd $D\n echo x > ${writeRoot}/a`)), context: { commandDenyList: [] }, outcome: "ask", ruleId: "safety.shell-outside-write-roots" },
  { name: "a subshell cd is checked", call: toolCall(shell("(cd /etc && cat\tpasswd) < in.txt")), context: auto, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "a working directory through a symlink out of the roots is denied in auto mode", call: toolCall(shell("ls", `${writeRoot}/out`)), context: { ...auto, ...links({ [`${writeRoot}/out`]: "/tmp" }) }, outcome: "deny", ruleId: "safety.shell-outside-write-roots" },
  { name: "a redirect through a symlink out of the roots asks", call: toolCall(shell("echo x > out/a")), context: links({ [`${writeRoot}/out/a`]: "/tmp/a" }), outcome: "ask", ruleId: "safety.shell-outside-write-roots" },
  { name: "a relative working directory resolves against the session cwd", call: toolCall(shell("ls", "src")), context: auto, outcome: "allow", ruleId: "permission.auto" },
];
