import AppKit

let size: CGFloat = 1024
let img = NSImage(size: NSSize(width: size, height: size))
img.lockFocus()
let ctx = NSGraphicsContext.current!.cgContext

// macOS icon grid: 824x824 rounded rect centered in 1024, radius ~185.
let inset: CGFloat = 100
let rect = CGRect(x: inset, y: inset, width: size - 2 * inset, height: size - 2 * inset)
let path = CGPath(roundedRect: rect, cornerWidth: 185, cornerHeight: 185, transform: nil)

// Soft drop shadow
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -12), blur: 28, color: NSColor.black.withAlphaComponent(0.28).cgColor)
ctx.addPath(path); ctx.setFillColor(NSColor.black.cgColor); ctx.fillPath()
ctx.restoreGState()

// Gradient body (fm banner colors: green → blue)
ctx.saveGState()
ctx.addPath(path); ctx.clip()
let colors = [NSColor(srgbRed: 130/255, green: 215/255, blue: 90/255, alpha: 1).cgColor,
              NSColor(srgbRed: 40/255, green: 170/255, blue: 160/255, alpha: 1).cgColor,
              NSColor(srgbRed: 35/255, green: 110/255, blue: 205/255, alpha: 1).cgColor] as CFArray
let grad = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors, locations: [0, 0.5, 1])!
ctx.drawLinearGradient(grad, start: CGPoint(x: rect.minX, y: rect.maxY), end: CGPoint(x: rect.maxX, y: rect.minY), options: [])
// Glass highlight on the top half
let hl = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                    colors: [NSColor.white.withAlphaComponent(0.30).cgColor, NSColor.white.withAlphaComponent(0.0).cgColor] as CFArray,
                    locations: [0, 1])!
ctx.drawLinearGradient(hl, start: CGPoint(x: 0, y: rect.maxY), end: CGPoint(x: 0, y: rect.midY), options: [])
ctx.restoreGState()

// Inner hairline
ctx.addPath(path); ctx.setStrokeColor(NSColor.white.withAlphaComponent(0.35).cgColor); ctx.setLineWidth(4); ctx.strokePath()

// Glyph: a terminal-style chevron plus sparkle, drawn with SF Symbols
func drawSymbol(_ name: String, pointSize: CGFloat, weight: NSFont.Weight, at center: CGPoint) {
    let cfg = NSImage.SymbolConfiguration(pointSize: pointSize, weight: weight)
        .applying(NSImage.SymbolConfiguration(paletteColors: [.white]))
    guard let sym = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(cfg) else { return }
    let s = sym.size
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -6), blur: 18, color: NSColor.black.withAlphaComponent(0.22).cgColor)
    sym.draw(in: CGRect(x: center.x - s.width / 2, y: center.y - s.height / 2, width: s.width, height: s.height))
    ctx.restoreGState()
}
drawSymbol("chevron.right", pointSize: 300, weight: .heavy, at: CGPoint(x: 400, y: 470))
drawSymbol("sparkle", pointSize: 230, weight: .bold, at: CGPoint(x: 640, y: 600))
// underscore cursor
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -6), blur: 18, color: NSColor.black.withAlphaComponent(0.22).cgColor)
let bar = CGPath(roundedRect: CGRect(x: 545, y: 300, width: 200, height: 52), cornerWidth: 26, cornerHeight: 26, transform: nil)
ctx.addPath(bar); ctx.setFillColor(NSColor.white.cgColor); ctx.fillPath()
ctx.restoreGState()

img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "icon-1024.png"))
print("ok")
