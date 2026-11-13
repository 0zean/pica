import SwiftUI

/// A placeholder for a view with nothing to show yet. One of the two places the brand gradient appears.
public struct EmptyState<Actions: View>: View {
    private let title: String
    private let message: String
    private let actions: Actions

    public init(_ title: String, message: String, @ViewBuilder actions: () -> Actions) {
        self.title = title
        self.message = message
        self.actions = actions()
    }

    public var body: some View {
        VStack(spacing: Spacing.medium) {
            BrandMark()
                .frame(width: 64, height: 64)
            Text(title)
                .font(Typography.title)
                .foregroundStyle(Palette.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(message)
                .font(Typography.body)
                .foregroundStyle(Palette.textPrimary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: Spacing.small) {
                actions
            }
            .padding(.top, Spacing.xSmall)
        }
        .padding(Spacing.xxLarge)
        .frame(maxWidth: .infinity)
        .background(BrandBackdrop())
        .clipShape(RoundedRectangle(cornerRadius: Radius.xLarge, style: .continuous))
    }
}

extension EmptyState where Actions == EmptyView {
    public init(_ title: String, message: String) {
        self.init(title, message: message) { EmptyView() }
    }
}
