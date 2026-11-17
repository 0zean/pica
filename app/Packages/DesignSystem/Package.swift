// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "DesignSystem",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "DesignSystem", targets: ["DesignSystem"]),
        // Snapshot rendering and comparison for the app packages' tests.
        .library(name: "DesignSystemTestSupport", targets: ["DesignSystemTestSupport"]),
    ],
    targets: [
        .target(
            name: "DesignSystem",
            resources: [.copy("Resources/PicaMark.png")]
        ),
        .target(name: "DesignSystemTestSupport", dependencies: ["DesignSystem"]),
        .testTarget(
            name: "DesignSystemTests",
            dependencies: ["DesignSystem", "DesignSystemTestSupport"],
            exclude: ["__Snapshots__"]
        ),
    ]
)
