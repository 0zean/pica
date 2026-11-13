import SwiftUI

/// A small status label, such as a session state or the token count in a header.
public struct Chip: View {
    public enum Tone: CaseIterable, Sendable {
        case neutral
        case accent
        case success
        case warning
        case danger

        var color: PicaColor {
            switch self {
            case .neutral: Palette.textSecondary
            case .accent: Palette.accent
            case .success: Palette.success
            case .warning: Palette.warning
            case .danger: Palette.danger
            }
        }
    }

    private let title: String
    private let systemImage: String?
    private let tone: Tone

    public init(_ title: String, systemImage: String? = nil, tone: Tone = .neutral) {
        self.title = title
        self.systemImage = systemImage
        self.tone = tone
    }

    public var body: some View {
        HStack(spacing: Spacing.xSmall) {
            if let systemImage {
                Image(systemName: systemImage).accessibilityHidden(true)
            }
            Text(title)
        }
        .font(Typography.caption.weight(.medium))
        .foregroundStyle(tone.color)
        .padding(.horizontal, Spacing.small)
        .padding(.vertical, Spacing.xxSmall)
        .background(Capsule().fill(Palette.surface))
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.5), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}
