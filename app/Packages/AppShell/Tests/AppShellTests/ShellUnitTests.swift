@testable import AppShell
import Foundation
import PicaProtocol
import Testing

@Suite struct SingleInstanceLockTests {
    @Test func aSecondCopyCannotTakeTheLockUntilTheFirstReleasesIt() throws {
        let url = FileManager.default.temporaryDirectory.appending(path: "pica-lock-\(UUID().uuidString)/app.lock")
        defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
        var first = try SingleInstanceLock.acquire(at: url)
        #expect(first != nil)
        // flock belongs to the open file description, so a second open in this process conflicts like another process would.
        #expect(try SingleInstanceLock.acquire(at: url) == nil)
        first = nil
        #expect(try SingleInstanceLock.acquire(at: url) != nil)
    }
}

@Suite struct EngineCommandTests {
    @Test func developmentEngineRunsTheTypeScriptEntryWithTypeStripping() throws {
        let command = try EngineCommand.resolve(
            environment: ["PICA_ENGINE_ENTRY": "/src/engine/main.ts", "PICA_NODE": "/opt/node"], bundle: .main
        ).get()
        #expect(command.executable.path == "/opt/node")
        #expect(command.arguments == ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "/src/engine/main.ts"])
    }

    @Test func developmentEngineWithoutNodeIsAnError() {
        let resolved = EngineCommand.resolve(environment: ["PICA_ENGINE_ENTRY": "/src/engine/main.ts"], bundle: .main)
        #expect(throws: EngineFailure.self) { try resolved.get() }
    }

    @Test func bundledEngineUsesTheS05Layout() throws {
        let app = FileManager.default.temporaryDirectory.appending(path: "Pica-\(UUID().uuidString).app")
        defer { try? FileManager.default.removeItem(at: app) }
        for file in ["Contents/Helpers/node", "Contents/Resources/engine/picad.mjs"] {
            let url = app.appending(path: file)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data().write(to: url)
        }
        let command = try EngineCommand.resolve(environment: [:], bundle: try #require(Bundle(url: app))).get()
        #expect(command.executable.path.hasSuffix("Contents/Helpers/node"))
        #expect(command.arguments.count == 1 && command.arguments[0].hasSuffix("Contents/Resources/engine/picad.mjs"))
        #expect(command.environment["COPILOT_CLI_PATH"]?.hasSuffix(
            "Contents/Resources/copilot/prebuilds/darwin-arm64/copilot-runtime") == true)
    }
}

@Suite struct EngineStatusPresentationTests {
    @Test func connectedShowsNothing() {
        let hello = EngineHelloResult(protocolVersion: .current, engineVersion: "0.0.0")
        #expect(EngineStatusPresentation(.connected(hello)).style == .hidden)
    }

    @Test func startingAndReconnectingAreBannersThatKeepTheWindowUsable() {
        #expect(EngineStatusPresentation(.starting).style == .banner)
        #expect(EngineStatusPresentation(.reconnecting).style == .banner)
        #expect(EngineStatusPresentation(.reconnecting).title == "Reconnecting to the engine…")
    }

    @Test func mismatchWithoutTheEngineVersionStillNamesTheAppVersion() {
        let presentation = EngineStatusPresentation(.incompatible(app: ProtocolVersion(major: 1, minor: 0), engine: nil))
        #expect(presentation.style == .blocking)
        #expect(presentation.message.contains("Pica speaks protocol 1.0, but the engine speaks a different protocol version"))
    }

    @Test func readyLineIsRecognized() {
        #expect(EngineProcess.isReady(#"{"ready":true,"socket":"/tmp/s"}"#))
        #expect(!EngineProcess.isReady(#"{"ready":false}"#))
        #expect(!EngineProcess.isReady("starting"))
    }
}
