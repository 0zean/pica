import SwiftUI

/// Records where the composer's box, the completion list and its rows are, in the window's coordinates (y down), for
/// layout tests. Nothing sets one in the app.
@MainActor
final class ComposerLayoutProbe {
    var frames: [String: CGRect] = [:]
}

extension EnvironmentValues {
    @Entry var composerLayoutProbe: ComposerLayoutProbe?
}

private struct ProbedFrame: ViewModifier {
    let name: String
    @Environment(\.composerLayoutProbe) private var probe

    func body(content: Content) -> some View {
        content.onGeometryChange(for: CGRect.self, of: { $0.frame(in: .global) }) { probe?.frames[name] = $0 }
    }
}

extension View {
    func probedFrame(_ name: String) -> some View {
        modifier(ProbedFrame(name: name))
    }
}
