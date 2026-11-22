import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SOCKET_PATH } from "../packages/server/src/paths.ts";
import { realHome } from "./setup/isolated-home.ts";

describe("engine tests", () => {
  it("never resolve the real home directory or its Pica data", () => {
    const realData = join(realHome, "Library", "Application Support", "Pica");
    expect(homedir()).not.toBe(realHome);
    expect(process.env["HOME"]).not.toBe(realHome);
    expect(DEFAULT_SOCKET_PATH.startsWith(realData)).toBe(false);
  });
});
