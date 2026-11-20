// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Usage",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "Usage", targets: ["Usage"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
        .package(path: "../EngineClient"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "Usage",
            dependencies: [
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                "DesignSystem",
            ]),
        .testTarget(
            name: "UsageTests",
            dependencies: [
                "Usage",
                "PicaProtocol",
                .product(name: "DesignSystemTestSupport", package: "DesignSystem"),
            ],
            exclude: ["__Snapshots__"],
            resources: [.copy("Fixtures")]),
    ]
)
