// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Review",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "Review", targets: ["Review"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
        .package(path: "../EngineClient"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "Review",
            dependencies: [
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                "DesignSystem",
            ]),
        .testTarget(
            name: "ReviewTests",
            dependencies: [
                "Review",
                "PicaProtocol",
                .product(name: "DesignSystemTestSupport", package: "DesignSystem"),
            ],
            exclude: ["__Snapshots__"],
            resources: [.copy("Fixtures")]),
    ]
)
