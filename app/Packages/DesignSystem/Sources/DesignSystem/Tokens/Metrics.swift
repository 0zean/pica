import SwiftUI

/// Spacing on a 4-point grid.
public enum Spacing {
    public static let xxSmall: CGFloat = 2
    public static let xSmall: CGFloat = 4
    public static let small: CGFloat = 8
    public static let medium: CGFloat = 12
    public static let large: CGFloat = 16
    public static let xLarge: CGFloat = 24
    public static let xxLarge: CGFloat = 32
}

/// Corner radii. Shapes use the continuous corner style.
public enum Radius {
    public static let small: CGFloat = 4
    public static let medium: CGFloat = 6
    public static let large: CGFloat = 10
    public static let xLarge: CGFloat = 16
}

/// Type scale for macOS, where body text is 13 points.
public enum Typography {
    public static let largeTitle = Font.system(size: 26, weight: .bold)
    public static let title = Font.system(size: 20, weight: .semibold)
    public static let headline = Font.system(size: 13, weight: .semibold)
    public static let body = Font.system(size: 13)
    public static let callout = Font.system(size: 12)
    public static let caption = Font.system(size: 11, weight: .medium)
    public static let code = Font.system(size: 12, weight: .medium, design: .monospaced)
}
