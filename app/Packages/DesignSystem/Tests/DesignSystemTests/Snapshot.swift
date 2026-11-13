import AppKit
import SwiftUI
import Testing
import DesignSystem

/// Renders SwiftUI views with `ImageRenderer` and compares them with reference PNGs committed under
/// `__Snapshots__/macOS-<major>/`. System text rendering changes between macOS releases, so each
/// major version keeps its own references; CI's `macos-26` image is the merge gate.
///
/// Set `PICA_RECORD_SNAPSHOTS=1` to write new references. A mismatch or a missing reference writes the
/// rendered image to `.snapshot-failures/` in the package, which CI uploads.
@MainActor
enum Snapshot {
    /// A pixel counts as different when any channel differs by more than this (out of 255).
    static let channelTolerance = 4
    /// The share of pixels allowed to differ, to absorb antialiasing changes within a macOS release.
    static let differingPixelTolerance = 0.005

    static func render(_ view: some View, width: CGFloat, appearance: Appearance) -> Bitmap {
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

    static func assertMatchesReference(_ bitmap: Bitmap, named name: String, sourceLocation: SourceLocation = #_sourceLocation) {
        let reference = referenceDirectory.appending(path: "\(name).png")
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

    private static var packageDirectory: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    }

    private static var referenceDirectory: URL {
        packageDirectory.appending(path: "Tests/DesignSystemTests/__Snapshots__/macOS-\(osMajor)")
    }

    private static var failureDirectory: URL {
        packageDirectory.appending(path: ".snapshot-failures/macOS-\(osMajor)")
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
struct Bitmap: Equatable {
    let width: Int
    let height: Int
    let bytes: [UInt8]

    init(width: Int, height: Int, bytes: [UInt8]) {
        self.width = width
        self.height = height
        self.bytes = bytes
    }

    init(_ image: CGImage) {
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

    init?(contentsOf url: URL) {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { return nil }
        self.init(image)
    }

    func differingPixelShare(from other: Bitmap, channelTolerance: Int) -> Double {
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

    func pngData() -> Data? {
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
    var colorScheme: ColorScheme {
        switch self {
        case .light, .lightIncreasedContrast: .light
        case .dark, .darkIncreasedContrast: .dark
        }
    }

    var contrast: ColorSchemeContrast {
        switch self {
        case .light, .dark: .standard
        case .lightIncreasedContrast, .darkIncreasedContrast: .increased
        }
    }

    var snapshotName: String {
        switch self {
        case .light: "light"
        case .dark: "dark"
        case .lightIncreasedContrast: "light-increased-contrast"
        case .darkIncreasedContrast: "dark-increased-contrast"
        }
    }
}
