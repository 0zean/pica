import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { normalizeRemoteUrl } from "@pica/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRegistryFixture, makeLocalRepo, value, type RegistryFixture } from "./helpers.ts";

describe("normalizeRemoteUrl", () => {
  const widget = "https://github.com/acme/widget";

  it.each([
    "git@github.com:acme/widget.git",
    "git@GitHub.com:Acme/Widget",
    "github.com:acme/widget.git",
    "ssh://git@github.com/acme/widget.git",
    "ssh://git@github.com:22/Acme/Widget.git/",
    "git+ssh://git@github.com/acme/widget",
    "https://github.com/Acme/Widget.git",
    "https://user:token@github.com/acme/widget/",
    "HTTPS://GITHUB.COM/ACME/WIDGET.GIT",
    "http://github.com/acme/widget",
    "git://github.com/acme/widget.git",
    "  https://github.com/acme/widget  ",
  ])("normalizes %s to the https form", (spelling) => {
    expect(value(normalizeRemoteUrl(spelling)).url).toBe(widget);
  });

  it("keeps different repositories and hosts apart", () => {
    const urls = [
      "git@github.com:acme/widget.git",
      "git@github.com:acme/widget-2.git",
      "git@github.com:other/widget.git",
      "git@ghe.example.com:acme/widget.git",
    ].map((spelling) => value(normalizeRemoteUrl(spelling)).url);
    expect(new Set(urls).size).toBe(4);
  });

  it("treats file URLs and absolute paths as one local form and keeps their case", () => {
    expect(value(normalizeRemoteUrl("file:///Users/Dev/Remotes/Widget.git")).url).toBe("file:///Users/Dev/Remotes/Widget");
    expect(value(normalizeRemoteUrl("/Users/Dev/Remotes/Widget/")).url).toBe("file:///Users/Dev/Remotes/Widget");
  });

  it.each(["", "widget", "https://github.com/", "ftp://github.com/acme/widget", "git@github.com:acme/../widget", "https://github.com/%zz"])(
    "rejects %j",
    (spelling) => {
      const result = normalizeRemoteUrl(spelling);
      expect(result.ok ? undefined : result.error.code).toBe("repo.invalid_url");
    },
  );
});

describe("adding by path", () => {
  let fixture: RegistryFixture;

  beforeEach(() => {
    fixture = createRegistryFixture();
  });

  afterEach(() => {
    fixture.dispose();
  });

  it("resolves two checkouts of one remote, spelled differently, to one Repo", async () => {
    const first = makeLocalRepo(join(fixture.root, "a/widget"), "git@github.com:Acme/Widget.git");
    const second = makeLocalRepo(join(fixture.root, "b/widget-copy"), "https://github.com/acme/widget");

    const fromFirst = value(await fixture.registry.addByPath(first));
    const fromSecond = value(await fixture.registry.addByPath(second));

    expect(fromSecond).toEqual(fromFirst);
    expect(fromFirst).toMatchObject({
      remoteUrl: "https://github.com/acme/widget",
      localPath: first,
      managed: false,
      defaultBranch: "main",
      cloneState: "ready",
    });
    expect(value(fixture.registry.list())).toEqual([fromFirst]);
  });

  it("resolves a subdirectory to its checkout", async () => {
    const checkout = makeLocalRepo(join(fixture.root, "widget"), "ssh://git@github.com/acme/widget.git");
    mkdirSync(join(checkout, "src/deep"), { recursive: true });
    const repo = value(await fixture.registry.addByPath(join(checkout, "src/deep")));
    expect(value(await fixture.registry.addByPath(checkout))).toEqual(repo);
    expect(repo.localPath).toBe(checkout);
  });

  it("returns the registered Repo when the same remote is added by URL, without cloning", async () => {
    const checkout = makeLocalRepo(join(fixture.root, "widget"), "git@github.com:acme/widget.git");
    const repo = value(await fixture.registry.addByPath(checkout));
    expect(value(await fixture.registry.addByUrl("https://GitHub.com/acme/widget.git"))).toEqual(repo);
    expect(value(fixture.registry.list())).toHaveLength(1);
  });

  it("keeps checkouts of different remotes as different Repos", async () => {
    const widget = value(await fixture.registry.addByPath(makeLocalRepo(join(fixture.root, "w"), "git@github.com:acme/widget.git")));
    const gadget = value(await fixture.registry.addByPath(makeLocalRepo(join(fixture.root, "g"), "git@github.com:acme/gadget.git")));
    expect(gadget.id).not.toBe(widget.id);
    expect(value(fixture.registry.list())).toHaveLength(2);
  });

  it("refuses a checkout without an origin remote", async () => {
    const result = await fixture.registry.addByPath(makeLocalRepo(join(fixture.root, "loner"), null));
    expect(result.ok ? undefined : result.error.code).toBe("repo.no_remote");
  });
});
