import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invalidFixturesDir, validFixturesDir } from "../../../tools/protocol-schema/paths.ts";
import { eventSchemas, eventTypes, SessionEvent } from "../src/index.ts";

const validDir = join(validFixturesDir, "events");
const invalidDir = join(invalidFixturesDir, "events");

function readFixture(dir: string, type: string): unknown {
  return JSON.parse(readFileSync(join(dir, `${type}.json`), "utf8"));
}

describe("event fixtures", () => {
  it.each([validDir, invalidDir])("%s holds exactly one fixture per event type", (dir) => {
    expect(readdirSync(dir).sort()).toEqual(eventTypes.map((type) => `${type}.json`).sort());
  });

  it.each(eventTypes)("accepts the valid %s fixture", (type) => {
    const fixture = readFixture(validDir, type);
    expect(eventSchemas[type].safeParse(fixture).error).toBeUndefined();
    expect(SessionEvent.parse(fixture)).toMatchObject({ type });
  });

  it.each(eventTypes)("rejects the invalid %s fixture", (type) => {
    const fixture = readFixture(invalidDir, type);
    expect(fixture).toMatchObject({ type });
    expect(SessionEvent.safeParse(fixture).success).toBe(false);
  });

  it("rejects an event type that does not exist", () => {
    const fixture = { ...(readFixture(validDir, "user.message") as object), type: "user.shouted" };
    expect(SessionEvent.safeParse(fixture).success).toBe(false);
  });
});
