// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Files",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "Files", targets: ["Files"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
        .package(path: "../EngineClient"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "Files",
            dependencies: [
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                "DesignSystem",
            ]),
        .testTarget(
            name: "FilesTests",
            dependencies: [
                "Files",
                "PicaProtocol",
            ]),
    ]
)
