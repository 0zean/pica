// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Updates",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "Updates", targets: ["Updates"]),
    ],
    dependencies: [
        // H-06: in-app updates from the appcast on GitHub Releases (docs/distribution.md). Pinned exactly.
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1"),
    ],
    targets: [
        .target(name: "Updates", dependencies: [.product(name: "Sparkle", package: "Sparkle")]),
        .testTarget(name: "UpdatesTests", dependencies: ["Updates"]),
    ]
)
