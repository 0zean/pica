import CoreGraphics

/// Whether the timeline keeps its newest row in sight. It follows while the user is at the bottom; scrolling up stops
/// it, so rows arriving then do not move what the user is reading; scrolling back to the bottom starts it again.
///
/// Only a change of the scroll offset alone counts as the user's scrolling. When the content or the viewport changes
/// size, the offset may move with it, and that says nothing about where the user wants to be.
struct ScrollFollow: Equatable {
    struct Geometry: Equatable {
        var offset: CGFloat
        var contentHeight: CGFloat
        var viewportHeight: CGFloat

        /// Within a few points of the end, so a fraction of a line left over still counts. Following the newest row
        /// leaves the list's bottom padding (8 points) below it, and rows can sit on half points on a Retina display,
        /// so the margin is a point more than the padding.
        var isAtBottom: Bool { offset + viewportHeight >= contentHeight - 9 }
    }

    private(set) var isFollowing = true

    mutating func update(from old: Geometry, to new: Geometry) {
        guard new.contentHeight == old.contentHeight, new.viewportHeight == old.viewportHeight else { return }
        guard new.offset != old.offset else { return }
        isFollowing = new.isAtBottom
    }
}
