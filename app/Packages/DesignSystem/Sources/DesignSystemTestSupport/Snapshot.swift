import AppKit
import SwiftUI
import Testing
import DesignSystem

/// Where a test target keeps its reference images: `<package>/Tests/<target>/__Snapshots__/macOS-<major>/`.
/// A mismatch or a missing reference writes the rendered image to `<package>/.snapshot-failures/`, which CI uploads.
public struct SnapshotLocation: Sendable {
    let package: URL
    let target: String

    /// `testFile` is any file directly inside the test target's directory, usually `#filePath`.
    public init(testFile: StaticString) {
        let targetDirectory = URL(fileURLWithPath: "\(testFile)").deletingLastPathComponent()
        target = targetDirectory.lastPathComponent
        package = targetDirectory.deletingLastPathComponent().deletingLastPathComponent()
    }
}

/// Renders SwiftUI views with `ImageRenderer` and compares them with reference PNGs committed under
/// `__Snapshots__/macOS-<major>/`. System text rendering changes between macOS releases, so each
/// major version keeps its own references; CI's `macos-26` image is the merge gate.
///
/// Set `PICA_RECORD_SNAPSHOTS=1` to write new references.
@MainActor
public enum Snapshot {
    /// A pixel counts as different when any channel differs by more than this (out of 255).
    public static let channelTolerance = 4
    /// The share of pixels allowed to differ, to absorb antialiasing changes within a macOS release.
    public static let differingPixelTolerance = 0.005

    public static func render(_ view: some View, width: CGFloat, appearance: Appearance) -> Bitmap {
        let content = view
            .frame(width: width)
            .background(Palette.background)
            .environment(\.colorScheme, appearance.colorScheme)
            .environment(\._colorSchemeContrast, appearance.contrast)
        let renderer = ImageRenderer(content: content)
        renderer.scale = 2
        renderer.isOpaque = true
        guard let image = renderer.cgImage else {
            Issue.record("ImageRenderer produced no image")
            return Bitmap(width: 0, height: 0, bytes: [])
        }
        return Bitmap(image)
    }

    public static func assertMatchesReference(
        _ bitmap: Bitmap, named name: String, in location: SnapshotLocation, sourceLocation: SourceLocation = #_sourceLocation
    ) {
        let reference = referenceDirectory(location).appending(path: "\(name).png")
        let failureDirectory = failureDirectory(location)
        if ProcessInfo.processInfo.environment["PICA_RECORD_SNAPSHOTS"] == "1" {
            write(bitmap, to: reference)
            return
        }
        guard let expected = Bitmap(contentsOf: reference) else {
            write(bitmap, to: failureDirectory.appending(path: "\(name).png"))
            Issue.record(
                "No reference image at \(reference.path). Run with PICA_RECORD_SNAPSHOTS=1 on macOS \(osMajor) to record one.",
                sourceLocation: sourceLocation)
            return
        }
        let difference = bitmap.differingPixelShare(from: expected, channelTolerance: channelTolerance)
        if difference > differingPixelTolerance {
            write(bitmap, to: failureDirectory.appending(path: "\(name).png"))
            Issue.record(
                "\(name) differs from its reference in \(String(format: "%.2f", difference * 100))% of pixels. Rendered image written to \(failureDirectory.path).",
                sourceLocation: sourceLocation)
        }
    }

    private static let osMajor = ProcessInfo.processInfo.operatingSystemVersion.majorVersion

    private static func referenceDirectory(_ location: SnapshotLocation) -> URL {
        location.package.appending(path: "Tests/\(location.target)/__Snapshots__/macOS-\(osMajor)")
    }

    private static func failureDirectory(_ location: SnapshotLocation) -> URL {
        location.package.appending(path: ".snapshot-failures/macOS-\(osMajor)")
    }

    private static func write(_ bitmap: Bitmap, to url: URL) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        guard let data = bitmap.pngData() else {
            Issue.record("Could not encode \(url.lastPathComponent)")
            return
        }
        do {
            try data.write(to: url)
        } catch {
            Issue.record("Could not write \(url.path): \(error)")
        }
    }
}

/// An 8-bit sRGB RGBA bitmap, so images from different sources compare byte for byte.
public struct Bitmap: Equatable, Sendable {
    public let width: Int
    public let height: Int
    public let bytes: [UInt8]

    public init(width: Int, height: Int, bytes: [UInt8]) {
        self.width = width
        self.height = height
        self.bytes = bytes
    }

    public init(_ image: CGImage) {
        width = image.width
        height = image.height
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8,
                bytesPerRow: image.width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        self.bytes = bytes
    }

    public init?(contentsOf url: URL) {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { return nil }
        self.init(image)
    }

    public func differingPixelShare(from other: Bitmap, channelTolerance: Int) -> Double {
        guard width == other.width, height == other.height else { return 1 }
        var differing = 0
        for pixel in stride(from: 0, to: bytes.count, by: 4) {
            for channel in 0..<4 where abs(Int(bytes[pixel + channel]) - Int(other.bytes[pixel + channel])) > channelTolerance {
                differing += 1
                break
            }
        }
        return Double(differing) / Double(max(width * height, 1))
    }

    public func pngData() -> Data? {
        var copy = bytes
        return copy.withUnsafeMutableBytes { buffer -> Data? in
            guard let context = CGContext(
                data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
                let image = context.makeImage()
            else { return nil }
            return NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
        }
    }
}

extension Appearance {
    public var colorScheme: ColorScheme {
        switch self {
        case .light, .lightIncreasedContrast: .light
        case .dark, .darkIncreasedContrast: .dark
        }
    }

    public var contrast: ColorSchemeContrast {
        switch self {
        case .light, .dark: .standard
        case .lightIncreasedContrast, .darkIncreasedContrast: .increased
        }
    }

    public var snapshotName: String {
        switch self {
        case .light: "light"
        case .dark: "dark"
        case .lightIncreasedContrast: "light-increased-contrast"
        case .darkIncreasedContrast: "dark-increased-contrast"
        }
    }
}
