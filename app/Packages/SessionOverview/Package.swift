// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "SessionOverview",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "SessionOverview", targets: ["SessionOverview"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
        .package(path: "../EngineClient"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "SessionOverview",
            dependencies: [
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                "DesignSystem",
            ]),
        .testTarget(
            name: "SessionOverviewTests",
            dependencies: ["SessionOverview", "PicaProtocol"]),
    ]
)
