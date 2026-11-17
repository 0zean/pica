// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Timeline",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "Timeline", targets: ["Timeline"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
        .package(path: "../EngineClient"),
        .package(path: "../DesignSystem"),
        // CommonMark and GitHub-flavored Markdown for assistant text (PLAN.md §8); see docs/session-timeline.md.
        .package(url: "https://github.com/swiftlang/swift-markdown.git", exact: "0.9.0"),  // swift-boundary: allow (SwiftPM fetches it at build time; the app never calls GitHub)
    ],
    targets: [
        .target(
            name: "Timeline",
            dependencies: [
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                "DesignSystem",
                .product(name: "Markdown", package: "swift-markdown"),
            ]),
        .testTarget(
            name: "TimelineTests",
            dependencies: [
                "Timeline",
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                .product(name: "EngineClientTestSupport", package: "EngineClient"),
                .product(name: "DesignSystemTestSupport", package: "DesignSystem"),
            ],
            exclude: ["__Snapshots__"]),
    ]
)
