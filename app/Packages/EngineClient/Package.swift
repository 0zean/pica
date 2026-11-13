// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "EngineClient",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "EngineClient", targets: ["EngineClient"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
    ],
    targets: [
        .target(name: "EngineClient", dependencies: ["PicaProtocol"]),
    ]
)
