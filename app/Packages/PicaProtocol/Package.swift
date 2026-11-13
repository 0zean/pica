// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "PicaProtocol",
    platforms: [.macOS(.v15)],
    products: [
        .library(name: "PicaProtocol", targets: ["PicaProtocol"]),
    ],
    targets: [
        .target(name: "PicaProtocol"),
    ]
)
