import SwiftUI

/// Every token and core component on one page. Snapshot tests and the accessibility audit run
/// against this view, so a new component is added here when it is added to the package.
public struct ComponentGallery: View {
    public init() {}

    public var body: some View {
        ScrollView {
            GalleryContent()
                .padding(Spacing.xLarge)
        }
        .background(Palette.background)
    }
}

/// The gallery without its scroll view, so snapshot tests can render its full height.
public struct GalleryContent: View {
    public init() {}

    public var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xLarge) {
            Text("Pica design system")
                .font(Typography.largeTitle)
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            GallerySection("Color") { ColorSwatches() }
            GallerySection("Type") { TypeSamples() }
            GallerySection("Spacing and radius") { MetricSamples() }
            GallerySection("Buttons") { ButtonSamples() }
            GallerySection("Chips") { ChipSamples() }
            GallerySection("Activity") { ActivitySamples() }
            GallerySection("Card") { CardSample() }
            GallerySection("Empty state") { EmptyStateSample() }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.background)
    }
}

private struct GallerySection<Content: View>: View {
    let title: String
    let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.medium) {
            Text(title)
                .font(Typography.title)
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            content
        }
    }
}

private struct ColorSwatches: View {
    private static let roles: [(String, PicaColor)] = [
        ("background", Palette.background), ("surface", Palette.surface),
        ("textPrimary", Palette.textPrimary), ("textSecondary", Palette.textSecondary),
        ("border", Palette.border), ("accent", Palette.accent), ("onAccent", Palette.onAccent),
        ("ring", Palette.ring), ("spark", Palette.spark), ("success", Palette.success),
        ("warning", Palette.warning), ("danger", Palette.danger),
        ("gradientStart", Palette.gradientStart), ("gradientEnd", Palette.gradientEnd),
    ]

    @Environment(\.self) private var environment

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: Spacing.medium, alignment: .leading)],
                  alignment: .leading, spacing: Spacing.medium) {
            ForEach(Self.roles, id: \.0) { name, color in
                HStack(spacing: Spacing.small) {
                    RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                        .fill(color)
                        .overlay(RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                            .strokeBorder(Palette.border, lineWidth: 1))
                        .frame(width: 28, height: 28)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(name).font(Typography.callout).foregroundStyle(Palette.textPrimary)
                        Text(color.rgb(for: Appearance(environment)).description)
                            .font(Typography.code).foregroundStyle(Palette.textSecondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
    }
}

private struct TypeSamples: View {
    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.small) {
            Text("Large title").font(Typography.largeTitle)
            Text("Title").font(Typography.title)
            Text("Headline").font(Typography.headline)
            Text("Body text reads at thirteen points.").font(Typography.body)
            Text("Callout").font(Typography.callout)
            Text("Caption").font(Typography.caption)
            Text("let code = \"monospaced\"").font(Typography.code)
        }
        .foregroundStyle(Palette.textPrimary)
    }
}

private struct MetricSamples: View {
    private static let spacings: [(String, CGFloat)] = [
        ("xxSmall", Spacing.xxSmall), ("xSmall", Spacing.xSmall), ("small", Spacing.small),
        ("medium", Spacing.medium), ("large", Spacing.large), ("xLarge", Spacing.xLarge), ("xxLarge", Spacing.xxLarge),
    ]
    private static let radii: [(String, CGFloat)] = [
        ("small", Radius.small), ("medium", Radius.medium), ("large", Radius.large), ("xLarge", Radius.xLarge),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.medium) {
            HStack(alignment: .bottom, spacing: Spacing.large) {
                ForEach(Self.spacings, id: \.0) { name, value in
                    VStack(spacing: Spacing.xSmall) {
                        Rectangle().fill(Palette.accent).frame(width: value, height: 24)
                        Text(name).font(Typography.caption).foregroundStyle(Palette.textSecondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            HStack(spacing: Spacing.large) {
                ForEach(Self.radii, id: \.0) { name, value in
                    VStack(spacing: Spacing.xSmall) {
                        RoundedRectangle(cornerRadius: value, style: .continuous)
                            .strokeBorder(Palette.ring, lineWidth: 2)
                            .frame(width: 48, height: 32)
                        Text(name).font(Typography.caption).foregroundStyle(Palette.textSecondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

private struct ButtonSamples: View {
    var body: some View {
        HStack(spacing: Spacing.small) {
            Button("New session") {}.buttonStyle(.pica(.primary))
            Button("Open repository") {}.buttonStyle(.pica(.secondary))
            Button("Discard changes") {}.buttonStyle(.pica(.destructive))
            Button("Unavailable") {}.buttonStyle(.pica(.primary)).disabled(true)
        }
    }
}

private struct ChipSamples: View {
    var body: some View {
        HStack(spacing: Spacing.small) {
            Chip("Idle")
            Chip("Working", systemImage: "sparkles", tone: .accent)
            Chip("Merged", systemImage: "checkmark", tone: .success)
            Chip("Needs approval", systemImage: "hand.raised", tone: .warning)
            Chip("Failed", systemImage: "xmark", tone: .danger)
        }
    }
}

private struct ActivitySamples: View {
    var body: some View {
        HStack(spacing: Spacing.xLarge) {
            sample("Idle") { ActivityMark(isWorking: false) }
            sample("Working") { ActivityMark(isWorking: true) }
            sample("60% done") { ActivityMark(isWorking: true, progress: 0.6) }
            sample("Small") { ActivityMark(isWorking: true).frame(width: 16, height: 16) }
        }
    }

    private func sample(_ caption: String, @ViewBuilder mark: () -> some View) -> some View {
        VStack(spacing: Spacing.xSmall) {
            mark().frame(width: 48, height: 48)
            Text(caption).font(Typography.caption).foregroundStyle(Palette.textSecondary)
        }
    }
}

private struct CardSample: View {
    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.small) {
                HStack {
                    Text("Refactor the session store").font(Typography.headline)
                    Spacer()
                    Chip("Working", tone: .accent)
                }
                Text("Three files changed in pica-engine. Waiting on the test run.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.textSecondary)
            }
            .foregroundStyle(Palette.textPrimary)
        }
    }
}

private struct EmptyStateSample: View {
    var body: some View {
        EmptyState("No sessions yet", message: "Start a session to put an agent to work in one of your repositories.") {
            Button("New session") {}.buttonStyle(.pica(.primary))
        }
    }
}
