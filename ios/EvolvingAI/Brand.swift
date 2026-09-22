import UIKit

/// The palette, taken from the `:root` block in `docs/index.html`. These four
/// are the only colours the native shell ever draws; everything else on screen
/// is the web app's own CSS.
enum Brand {
    static let background = UIColor(red: 0x1c / 255, green: 0x36 / 255, blue: 0x4e / 255, alpha: 1) // --bg
    static let accent     = UIColor(red: 0xec / 255, green: 0xc1 / 255, blue: 0x87 / 255, alpha: 1) // --accent
    static let text       = UIColor(red: 0xf6 / 255, green: 0xe3 / 255, blue: 0xc9 / 255, alpha: 1) // --text
    static let muted      = UIColor(red: 0xc4 / 255, green: 0xb3 / 255, blue: 0x96 / 255, alpha: 1) // --muted
}
