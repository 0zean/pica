// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "EngineClient",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "EngineClient", targets: ["EngineClient"]),
        .library(name: "EngineClientTestSupport", targets: ["EngineClientTestSupport"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
    ],
    targets: [
        .target(name: "EngineClient", dependencies: ["PicaProtocol"]),
        .target(name: "EngineClientTestSupport", dependencies: ["EngineClient", "PicaProtocol"]),
        .testTarget(
            name: "EngineClientTests",
            dependencies: ["EngineClient", "EngineClientTestSupport", "PicaProtocol"]),
    ]
)
