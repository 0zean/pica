import Composer
import Testing

@Suite struct MentionResolverTests {
    let atlas = MentionRepo(id: "r1", name: "atlas", path: "/work/atlas")
    let beacon = MentionRepo(id: "r2", name: "beacon", path: nil)

    var resolver: MentionResolver {
        MentionResolver(repos: [atlas, beacon], agents: ["bulk-reader", "beacon"])
    }

    @Test func resolvesAgentsReposAndFiles() {
        #expect(resolver.resolve("atlas") == .repo(atlas))
        #expect(resolver.resolve("atlas:src/a.ts") == .file(atlas, path: "src/a.ts"))
        #expect(resolver.resolve("bulk-reader") == .agent("bulk-reader"))
        // An agent wins over a repo of the same name.
        #expect(resolver.resolve("beacon") == .agent("beacon"))
        #expect(resolver.resolve("beacon:x") == .file(beacon, path: "x"))
        #expect(resolver.resolve("comet") == .unknown)
        #expect(resolver.resolve("comet:a") == .unknown)
        #expect(resolver.resolve("atlas:") == .unknown)
    }

    @Test func aMessageWithoutKnownLocationsIsSentAsWritten() {
        #expect(resolver.message(for: "hello") == "hello")
        #expect(resolver.message(for: "ask @bulk-reader about @beacon:x") == "ask @bulk-reader about @beacon:x")
    }

    @Test func aMessageListsWhereItsReposAndFilesAre() {
        let text = "compare @atlas:src/a.ts with @\"atlas:My Docs/b.md\" in @atlas, and @atlas again"
        #expect(resolver.message(for: text) == text + """


            ---
            @atlas:src/a.ts: /work/atlas/src/a.ts
            @atlas:My Docs/b.md: /work/atlas/My Docs/b.md
            @atlas: /work/atlas
            """)
    }

    @Test func repoNamesComeFromTheRemoteOrPath() {
        #expect(MentionRepo.name(of: .fixture(remoteUrl: "https://git.example.com/acme/atlas.git")) == "atlas")
        #expect(MentionRepo.name(of: .fixture(remoteUrl: "git@git.example.com:acme/beacon.git")) == "beacon")
        #expect(MentionRepo.name(of: .fixture(localPath: "/Users/me/src/comet")) == "comet")
    }
}
