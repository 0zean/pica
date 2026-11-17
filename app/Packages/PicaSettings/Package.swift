// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "PicaSettings",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "PicaSettings", targets: ["PicaSettings"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
        .package(path: "../EngineClient"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "PicaSettings",
            dependencies: [
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                "DesignSystem",
            ]),
        .testTarget(
            name: "PicaSettingsTests",
            dependencies: [
                "PicaSettings",
                "PicaProtocol",
            ]),
    ]
)
