import SwiftUI

/// The app's button style. Drawn entirely from tokens so it looks the same on every macOS release.
public struct PicaButtonStyle: ButtonStyle {
    public enum Role: Sendable {
        case primary
        case secondary
        case destructive
    }

    private let role: Role

    public init(_ role: Role) {
        self.role = role
    }

    public func makeBody(configuration: Configuration) -> some View {
        PicaButtonBody(configuration: configuration, role: role)
    }
}

extension ButtonStyle where Self == PicaButtonStyle {
    public static func pica(_ role: PicaButtonStyle.Role = .secondary) -> PicaButtonStyle {
        PicaButtonStyle(role)
    }
}

private struct PicaButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let role: PicaButtonStyle.Role
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.picaDensity) private var density
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Radius.medium, style: .continuous)
        configuration.label
            .font(Typography.headline)
            .foregroundStyle(foreground)
            .padding(.horizontal, density.spacing(Spacing.medium))
            .frame(minHeight: density.buttonHeight)
            .background(shape.fill(fill))
            .overlay(shape.strokeBorder(border, lineWidth: role == .secondary ? 1 : 0))
            .contentShape(shape)
            .opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.45)
            .animation(Motion.animation(.quick, reduceMotion: reduceMotion), value: configuration.isPressed)
    }

    private var fill: PicaColor {
        switch role {
        case .primary: Palette.accent
        case .secondary: Palette.surface
        case .destructive: Palette.danger
        }
    }

    private var foreground: PicaColor {
        role == .secondary ? Palette.textPrimary : Palette.onAccent
    }

    private var border: PicaColor {
        Palette.border
    }
}
