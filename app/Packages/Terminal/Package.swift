// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Terminal",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "Terminal", targets: ["Terminal"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
        .package(path: "../EngineClient"),
        .package(path: "../DesignSystem"),
        // The terminal emulator and its pseudo-terminal (PLAN.md §8); see docs/terminal.md.
        .package(url: "https://github.com/migueldeicaza/SwiftTerm.git", exact: "1.18.0"),  // swift-boundary: allow (SwiftPM fetches it at build time; the app never calls GitHub)
    ],
    targets: [
        .target(
            name: "Terminal",
            dependencies: [
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                "DesignSystem",
                .product(name: "SwiftTerm", package: "SwiftTerm"),
            ]),
        .testTarget(
            name: "TerminalTests",
            dependencies: [
                "Terminal",
                "PicaProtocol",
            ]),
    ]
)
