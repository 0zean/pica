// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Features",
    platforms: [.macOS(.v15)],
    targets: [
        .target(name: "Sidebar"),
        .target(name: "Session", dependencies: ["Sidebar"]),
    ]
)
