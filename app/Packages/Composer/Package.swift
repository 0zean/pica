// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Composer",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "Composer", targets: ["Composer"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
        .package(path: "../EngineClient"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "Composer",
            dependencies: [
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                "DesignSystem",
            ]),
        .testTarget(
            name: "ComposerTests",
            dependencies: [
                "Composer",
                "PicaProtocol",
            ]),
    ]
)
