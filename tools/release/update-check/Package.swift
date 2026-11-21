// swift-tools-version: 6.2
import PackageDescription

// H-06's update check: Sparkle's own updater, driven without UI, updates an installed Pica.app from an appcast.
let package = Package(
    name: "pica-update-check",
    platforms: [.macOS(.v26)],
    dependencies: [
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1"),
    ],
    targets: [
        .executableTarget(
            name: "pica-update-check",
            dependencies: [.product(name: "Sparkle", package: "Sparkle")],
            linkerSettings: [.unsafeFlags(["-Xlinker", "-rpath", "-Xlinker", "@executable_path"])]),
    ]
)
