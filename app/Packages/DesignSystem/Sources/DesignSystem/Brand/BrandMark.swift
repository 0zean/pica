import AppKit
import SwiftUI

/// The Pica logo: the magpie in its ring on the glass tile, cut from `docs/Magpie Glass Icon.png`.
public struct BrandMark: View {
    public init() {}

    public var body: some View {
        Image(nsImage: Self.image)
            .resizable()
            .interpolation(.high)
            .aspectRatio(1, contentMode: .fit)
            .accessibilityLabel("Pica")
            .accessibilityAddTraits(.isImage)
    }

    public static let image: NSImage = {
        guard let url = Bundle.module.url(forResource: "PicaMark", withExtension: "png"),
              let image = NSImage(contentsOf: url)
        else { preconditionFailure("PicaMark.png is missing from the DesignSystem bundle") }
        return image
    }()
}

/// The periwinkle-to-peach gradient from the logo's backdrop. Under increased contrast it gives way
/// to the plain background so text keeps its full contrast.
public struct BrandBackdrop: View {
    @Environment(\.self) private var environment

    public init() {}

    public var body: some View {
        LinearGradient(
            colors: [
                Color(Palette.gradientStart.resolve(in: environment)),
                Color(Palette.gradientEnd.resolve(in: environment)),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing)
    }
}
