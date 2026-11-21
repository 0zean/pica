import SwiftUI

/// How much room components leave around their content (docs/themes.md). The raw value is config.jsonc's
/// `appearance.density`.
public enum Density: String, CaseIterable, Sendable {
    case compact
    case regular
    case comfortable

    public var title: String {
        switch self {
        case .compact: "Compact"
        case .regular: "Regular"
        case .comfortable: "Comfortable"
        }
    }

    /// What padding and gaps are multiplied by.
    public var scale: CGFloat {
        switch self {
        case .compact: 0.75
        case .regular: 1
        case .comfortable: 1.25
        }
    }

    /// A `Spacing` value at this density, on whole points.
    public func spacing(_ base: CGFloat) -> CGFloat {
        (base * scale).rounded()
    }

    public var controlSize: ControlSize {
        switch self {
        case .compact: .small
        case .regular: .regular
        case .comfortable: .large
        }
    }

    public var minimumListRowHeight: CGFloat {
        switch self {
        case .compact: 22
        case .regular: 28
        case .comfortable: 34
        }
    }

    /// The minimum height of a `PicaButtonStyle` button.
    var buttonHeight: CGFloat {
        switch self {
        case .compact: 20
        case .regular: 24
        case .comfortable: 30
        }
    }
}
