// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "AppShell",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "AppShell", targets: ["AppShell"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
        .package(path: "../EngineClient"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "AppShell",
            dependencies: [
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                "DesignSystem",
            ]),
        .testTarget(
            name: "AppShellTests",
            dependencies: [
                "AppShell",
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                .product(name: "EngineClientTestSupport", package: "EngineClient"),
            ]),
    ]
)
