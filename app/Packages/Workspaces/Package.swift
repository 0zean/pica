// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Workspaces",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "Workspaces", targets: ["Workspaces"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
        .package(path: "../EngineClient"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "Workspaces",
            dependencies: [
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                "DesignSystem",
            ]),
        .testTarget(
            name: "WorkspacesTests",
            dependencies: [
                "Workspaces",
                "PicaProtocol",
            ]),
    ]
)
