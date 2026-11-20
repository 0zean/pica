import AppKit
import SwiftUI

/// Shows a shell's terminal view. The view belongs to the shell, so it keeps its screen when the panel is drawn
/// again for the same session; give each shell its own `id`.
struct TerminalHost: NSViewRepresentable {
    let shell: TerminalShell

    func makeNSView(context: Context) -> PicaTerminalView {
        let view = shell.view
        Task { @MainActor in
            view.window?.makeFirstResponder(view)
        }
        return view
    }

    func updateNSView(_ view: PicaTerminalView, context: Context) {}
}
