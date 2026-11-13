import DesignSystem
import SwiftUI

/// Hosts the design system's component gallery for UI tests and for browsing the components.
@main
struct PicaGalleryApp: App {
    var body: some Scene {
        WindowGroup("Pica Gallery") {
            ComponentGallery()
                .frame(minWidth: 800, minHeight: 700)
        }
    }
}
