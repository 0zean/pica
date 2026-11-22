import AppKit
import DesignSystem
import DesignSystemTestSupport
import PicaProtocol
import SwiftUI
import Testing
@testable import McpServers

/// The MCP Servers window's rows at the window's minimum width: a server that needs sign-in shows Sign In, Edit and ⋯
/// on one line (their labels once wrapped one letter per line), and no column is squeezed into wrapping.
@MainActor
@Suite struct ServerRowLayoutTests {
    private let location = SnapshotLocation(testFile: #filePath)

    @Test func theWidestActionsFitTheirColumn() {
        let actions = ServerRowActions(
            server: Self.server, needsAuth: true, offersSignIn: true, edit: {}, signIn: {}, recheck: {}, remove: {})
        let size = Self.naturalSize(actions)
        #expect(size.width <= Column.actions, "Sign In, Edit and ⋯ need \(size.width) pt; the column is \(Column.actions) pt")
        // One line of buttons, not a stack of letters.
        #expect(size.height < 40, "the actions are \(size.height) pt tall")
    }

    @Test(arguments: [false, true])
    func aRowThatNeedsSignInIsAsTallAsAHealthyOne(_ showsAttachment: Bool) {
        let needsAuth = Self.rowHeight(Self.row(.needsAuth, showsAttachment: showsAttachment))
        let healthy = Self.rowHeight(Self.row(.healthy, showsAttachment: showsAttachment))
        #expect(needsAuth == healthy, "a needs-sign-in row is \(needsAuth) pt tall, a healthy one \(healthy) pt")
        #expect(healthy < 60, "a healthy row is \(healthy) pt tall at the window's minimum width")
    }

    @Test(arguments: [Appearance.light, .dark])
    func theListAtMinimumWidthMatchesReference(_ appearance: Appearance) {
        let list = VStack(spacing: 0) {
            ServerRowHeader(showsAttachment: true)
            Self.row(.needsAuth, showsAttachment: true)
            Divider()
            Self.row(.healthy, showsAttachment: true)
        }
        Snapshot.assertMatchesReference(
            Snapshot.render(list, width: Column.minimumRowWidth, appearance: appearance),
            named: "rows-minimum-width-\(appearance.snapshotName)", in: location)
    }

    // MARK: - Fixtures

    static let server = McpServerDef(
        id: "linear", name: "Linear",
        transport: .http(.init(type: .http, url: "https://mcp.linear.app/mcp", headers: [:])),
        toolAllowlist: nil, scope: .global)

    static func row(_ state: McpServerStatus.State, showsAttachment: Bool) -> ServerRow {
        let status = McpServerStatus(
            serverId: server.id, state: state, lastError: nil, tools: state == .healthy ? ["a", "b", "c"] : [],
            latencyMs: nil, toolDefinitionTokens: state == .healthy ? 12_345 : nil, checkedAt: nil, restarts: 0)
        return ServerRow(
            server: server, status: status, attached: showsAttachment ? .constant(true) : nil, offersSignIn: true,
            edit: {}, signIn: {}, recheck: {}, remove: {})
    }

    static func naturalSize(_ view: some View) -> CGSize {
        let renderer = ImageRenderer(content: view.fixedSize())
        renderer.scale = 1
        return renderer.cgImage.map { CGSize(width: $0.width, height: $0.height) } ?? .zero
    }

    static func rowHeight(_ row: ServerRow) -> CGFloat {
        let renderer = ImageRenderer(content: row.frame(width: Column.minimumRowWidth).fixedSize(horizontal: false, vertical: true))
        renderer.scale = 1
        return renderer.cgImage.map { CGFloat($0.height) } ?? 0
    }
}
