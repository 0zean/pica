@testable import AppShell
import Foundation
import Testing

/// H-05: when the engine moved a damaged database aside, the window says where it went.
@Suite(.serialized, .timeLimit(.minutes(1))) struct StoreRecoveryTests {
    @MainActor @Test func aDamagedDatabaseIsReportedWithItsBackupPathUntilDismissed() async throws {
        let fixture = try EngineFixture()
        defer { fixture.remove() }
        try FileManager.default.createDirectory(at: fixture.dataDirectory, withIntermediateDirectories: true)
        let database = fixture.dataDirectory.appending(path: "pica.db")
        try Data(repeating: 0x07, count: 8192).write(to: database)
        let supervisor = try fixture.supervisor()
        let model = AppModel(supervisor: supervisor)
        var shown = Observations { model.storeRecovery }.makeAsyncIterator()
        model.start()

        var recovery = await shown.next() ?? nil
        while recovery == nil, let next = await shown.next() { recovery = next }
        let backupPath = try #require(recovery?.backupPath)
        #expect(backupPath.hasPrefix(database.path + ".corrupt-"), "\(backupPath)")
        #expect(FileManager.default.fileExists(atPath: backupPath))
        #expect(model.engineStatus.isConnected)

        model.dismissStoreRecovery()
        #expect(model.storeRecovery == nil)
        await supervisor.stop()
    }
}
