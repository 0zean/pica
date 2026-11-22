// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "McpServers",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "McpServers", targets: ["McpServers"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
        .package(path: "../EngineClient"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "McpServers",
            dependencies: [
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                "DesignSystem",
            ]),
        .testTarget(
            name: "McpServersTests",
            dependencies: [
                "McpServers",
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                .product(name: "DesignSystemTestSupport", package: "DesignSystem"),
            ],
            exclude: ["__Snapshots__"]),
    ]
)
