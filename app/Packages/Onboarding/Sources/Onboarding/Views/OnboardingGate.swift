import SwiftUI

/// Shows onboarding in place of the window's content while it is needed (docs/onboarding.md). "Set Up Later" hides it
/// until Pica is next launched. `isNeeded` is read in the gate's body, so the observable state it reads is followed.
public struct OnboardingGate<Content: View>: View {
    private let store: OnboardingStore
    private let isNeeded: @MainActor () -> Bool
    private let content: Content
    @State private var deferred = false

    public init(store: OnboardingStore, isNeeded: @escaping @MainActor () -> Bool, @ViewBuilder content: () -> Content) {
        self.store = store
        self.isNeeded = isNeeded
        self.content = content()
    }

    public var body: some View {
        if isNeeded() && !deferred {
            OnboardingScreen(store: store) { deferred = true }
        } else {
            content
        }
    }
}
