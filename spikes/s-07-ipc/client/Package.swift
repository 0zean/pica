// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "S07Client",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(name: "S07Client")
    ]
)
