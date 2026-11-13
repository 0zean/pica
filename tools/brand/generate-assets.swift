// Regenerates the brand bitmaps from the logo. Run from the repository root:
//   swift tools/brand/generate-assets.swift
// Outputs the DesignSystem's PicaMark.png and the Pica app icon set.
import AppKit

let logoPath = "docs/Magpie Glass Icon.png"
let markPath = "app/Packages/DesignSystem/Sources/DesignSystem/Resources/PicaMark.png"
let iconSetDir = "app/Pica/Assets.xcassets/AppIcon.appiconset"

// The glass tile inside the 1254-pixel logo, measured from the image.
let tileInLogo = CGRect(x: 220, y: 198, width: 815, height: 815)
let tileCornerFraction = 0.225
// Apple's macOS icon grid: an 824-point tile centred on a 1024-point canvas.
let iconTileFraction = 824.0 / 1024.0

func loadLogo() -> CGImage {
    guard let image = NSImage(contentsOfFile: logoPath),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
    else { fatalError("cannot read \(logoPath)") }
    return cgImage
}

/// Draws the tile, clipped to its rounded rectangle, centred on a transparent square canvas.
func render(_ logo: CGImage, pixels: Int, tileFraction: Double) -> CGImage {
    let context = CGContext(
        data: nil, width: pixels, height: pixels, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.interpolationQuality = .high
    let side = Double(pixels) * tileFraction
    let origin = (Double(pixels) - side) / 2
    let tile = CGRect(x: origin, y: origin, width: side, height: side)
    let radius = side * tileCornerFraction
    context.addPath(CGPath(roundedRect: tile, cornerWidth: radius, cornerHeight: radius, transform: nil))
    context.clip()
    let cropped = logo.cropping(to: tileInLogo)!
    context.draw(cropped, in: tile)
    return context.makeImage()!
}

func writePNG(_ image: CGImage, to path: String) {
    let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])!
    try! data.write(to: URL(fileURLWithPath: path))
}

let logo = loadLogo()
writePNG(render(logo, pixels: 512, tileFraction: 1), to: markPath)

try! FileManager.default.createDirectory(atPath: iconSetDir, withIntermediateDirectories: true)
var entries: [String] = []
for points in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = "icon_\(points)x\(points)\(scale == 2 ? "@2x" : "").png"
        writePNG(render(logo, pixels: points * scale, tileFraction: iconTileFraction), to: "\(iconSetDir)/\(name)")
        entries.append(#"    { "filename" : "\#(name)", "idiom" : "mac", "scale" : "\#(scale)x", "size" : "\#(points)x\#(points)" }"#)
    }
}
let contents = "{\n  \"images\" : [\n\(entries.joined(separator: ",\n"))\n  ],\n  \"info\" : { \"author\" : \"xcode\", \"version\" : 1 }\n}\n"
try! contents.write(toFile: "\(iconSetDir)/Contents.json", atomically: true, encoding: .utf8)
try! "{\n  \"info\" : { \"author\" : \"xcode\", \"version\" : 1 }\n}\n".write(
    toFile: "app/Pica/Assets.xcassets/Contents.json", atomically: true, encoding: .utf8)
