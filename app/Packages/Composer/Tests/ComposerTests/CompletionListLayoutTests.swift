@testable import Composer
import AppKit
import SwiftUI
import Testing

/// Where the completion list lands in a real window: the composer at the bottom of a column under a scrolling
/// timeline, as the app target lays them out. Frames are in the window's coordinates, y down.
@MainActor
@Suite(.serialized) struct CompletionListLayoutTests {
    let backend = FakeBackend()

    /// Opens the list for `text` with what the fake offers for `@`: 2 repos and `agents` agents (eight items at most).
    func composer(height: CGFloat, agents: Int = 6, text: String = "@") async throws -> Hosted {
        backend.agentNames = (1...agents).map { "agent-\($0)" }
        let store = ComposerStore(session: .fixture(state: .idle), backend: backend, drafts: nil)
        await store.load()
        store.textDidChange(text, caret: text.utf16.count)
        let hosted = Hosted(store: store, size: CGSize(width: 640, height: height))
        try await hosted.settle()
        return hosted
    }

    @Test func listOpensAboveTheComposerAndInsideTheWindow() async throws {
        let hosted = try await composer(height: 600)
        let list = try #require(hosted.frame("list"))
        let box = try #require(hosted.frame("box"))
        #expect(list.maxY <= box.minY, "the list overlaps or hangs below the composer: list \(list), composer \(box)")
        #expect(hosted.bounds.contains(list), "list \(list) is outside the window \(hosted.bounds)")
        let items = hosted.store.completion?.items ?? []
        #expect(items.count == 8)
        for item in items {
            let frame = try #require(hosted.frame(item.id))
            #expect(list.contains(frame), "\(item.id) at \(frame) is outside the list \(list)")
        }
    }

    @Test func aShortWindowCapsTheListAndKeepsTheSelectionInView() async throws {
        let hosted = try await composer(height: 220)
        let list = try #require(hosted.frame("list"))
        let box = try #require(hosted.frame("box"))
        #expect(list.maxY <= box.minY)
        #expect(hosted.bounds.contains(list), "list \(list) is outside the window \(hosted.bounds)")
        #expect(list.height > 40, "the list collapsed: \(list)")
        let items = try #require(hosted.store.completion?.items)
        let last = try #require(hosted.frame(items[items.count - 1].id))
        #expect(!list.contains(last), "the window is short enough that the last row should start out of view")

        // ↓ through every row and wrap back to the first: the selected row is always in view.
        for _ in 0..<items.count {
            hosted.store.moveSelection(by: 1)
            try await hosted.settle()
            let selected = try #require(hosted.store.completion.map { $0.items[$0.selected] })
            let frame = try #require(hosted.frame(selected.id))
            let visible = try #require(hosted.frame("list")).insetBy(dx: 0, dy: -0.5)
            #expect(visible.contains(frame), "the selected \(selected.id) at \(frame) is out of view in \(visible)")
        }
    }

    @Test func aTallComposerStillKeepsTheListInsideTheWindow() async throws {
        let short = try await composer(height: 300)
        let shortBox = try #require(short.frame("box"))
        short.close()

        let hosted = try await composer(height: 300, text: String(repeating: "line\n", count: 7) + "@")
        let list = try #require(hosted.frame("list"))
        let box = try #require(hosted.frame("box"))
        #expect(box.height > shortBox.height + 80, "the input did not grow: \(box) vs \(shortBox)")
        #expect(list.maxY <= box.minY)
        #expect(hosted.bounds.contains(list), "list \(list) is outside the window \(hosted.bounds)")
    }
}

/// A window holding a stand-in timeline and the composer under it, in the completion bounds the app declares.
@MainActor
final class Hosted {
    let store: ComposerStore
    let probe = ComposerLayoutProbe()
    private let window: NSWindow
    private let host: NSView

    init(store: ComposerStore, size: CGSize) {
        self.store = store
        let column = VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading) {
                    ForEach(0..<40, id: \.self) { Text("Timeline row \($0)").frame(maxWidth: .infinity, alignment: .leading) }
                }
            }
            ComposerView(store: store)
        }
        .coordinateSpace(ComposerView.completionBounds)
        .frame(width: size.width, height: size.height)
        .environment(\.composerLayoutProbe, probe)
        host = NSHostingView(rootView: column)
        window = NSWindow(contentRect: NSRect(origin: CGPoint(x: 100, y: 100), size: size), styleMask: [.titled], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = host
        window.orderFrontRegardless()
    }

    var bounds: CGRect { host.bounds }

    func frame(_ name: String) -> CGRect? { probe.frames[name] }

    func close() { window.close() }

    func settle() async throws {
        for _ in 0..<6 {
            try await Task.sleep(for: .milliseconds(40))
            host.layoutSubtreeIfNeeded()
        }
    }
}

extension Hosted: CustomTestStringConvertible {
    nonisolated var testDescription: String { "the hosted composer" }
}
