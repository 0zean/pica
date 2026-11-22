import { mkdtempSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";

// Every engine test, and every engine it spawns with the inherited environment, gets a home directory of its own,
// so nothing can open, migrate or write the developer's real `~/Library/Application Support/Pica` (it happened once:
// startup-benchmark.test.ts migrated the owner's pica.db to a newer schema). `userInfo().homedir` reads the user
// database, not HOME, so it is the real home whatever HOME says.
export const realHome = userInfo().homedir;

if (process.env["PICA_TEST_REAL_HOME"] === undefined) {
  process.env["PICA_TEST_REAL_HOME"] = realHome;
}
if (homedir() === realHome) {
  process.env["HOME"] = mkdtempSync(join(tmpdir(), "pica-test-home-"));
}
if (homedir() === realHome) {
  throw new Error(`engine tests must not run with the real home directory ${realHome}`);
}
