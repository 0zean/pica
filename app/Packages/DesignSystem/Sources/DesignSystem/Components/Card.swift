import SwiftUI

/// An opaque content container. Content areas stay opaque for legibility (PLAN.md §7.3).
public struct Card<Content: View>: View {
    private let content: Content

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.large, style: .continuous)
        content
            .padding(Spacing.large)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(shape.fill(Palette.surface))
            .overlay(shape.strokeBorder(Palette.border, lineWidth: 1))
    }
}
