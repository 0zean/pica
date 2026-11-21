// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Customization",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "Customization", targets: ["Customization"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
        .package(path: "../EngineClient"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "Customization",
            dependencies: [
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                "DesignSystem",
            ]),
        .testTarget(
            name: "CustomizationTests",
            dependencies: [
                "Customization",
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
            ]),
    ]
)
