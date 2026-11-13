// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "PicaProtocol",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "PicaProtocol", targets: ["PicaProtocol"]),
    ],
    targets: [
        .target(name: "PicaProtocol"),
    ]
)
