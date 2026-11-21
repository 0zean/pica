// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "Onboarding",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "Onboarding", targets: ["Onboarding"]),
    ],
    dependencies: [
        .package(path: "../PicaProtocol"),
        .package(path: "../EngineClient"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "Onboarding",
            dependencies: [
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
                "DesignSystem",
            ]),
        .testTarget(
            name: "OnboardingTests",
            dependencies: [
                "Onboarding",
                "PicaProtocol",
                .product(name: "EngineClient", package: "EngineClient"),
            ]),
    ]
)
