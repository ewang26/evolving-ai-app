import Foundation
import WebKit

/// Serves the bundled web app over a private scheme.
///
/// Loading the same files from `file://` would be simpler and wrong: WKWebView
/// hands a file URL an opaque origin, and `localStorage` — which is where a
/// half-finished submission lives between launches — throws on an opaque
/// origin. A custom scheme gets a real, stable origin, so the storage the app
/// already relies on behaves exactly as it does on the website.
///
/// The responses are deliberately synchronous. Every asset is local and small
/// (the whole app is one 93KB file), and answering on the calling thread means
/// a task can never be stopped between `didReceive` and `didFinish`, which is
/// the one way this API crashes.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {

    static let scheme = "seminar"
    static let host = "app"
    static let baseURL = URL(string: "\(scheme)://\(host)/index.html")!

    /// The organizer console, which the page selects from the fragment at
    /// startup — the same thing typing `#organizer` does on the website.
    ///
    /// The query string is what makes this work. WKWebView treats a URL that
    /// differs only by fragment as a same-document navigation and does not
    /// re-run the page, and it does not fire `hashchange` for a custom scheme
    /// either, so the fragment alone would change the URL and nothing else.
    /// A differing query forces a real load. The handler routes on path, and
    /// the page only ever reads `api` out of the query, so it is inert.
    static let organizerURL = URL(string: "\(scheme)://\(host)/index.html?view=organizer#organizer")!

    private let root: URL

    /// Fails loudly at launch rather than showing an empty web view: a missing
    /// `web` folder means the build phase did not copy it, which is a build
    /// bug, not a runtime condition to recover from.
    override init() {
        guard let root = Bundle.main.url(forResource: "web", withExtension: nil) else {
            fatalError("The bundled `web` folder is missing. Run scripts/sync-web.sh and rebuild.")
        }
        self.root = root.standardizedFileURL
        super.init()
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else {
            task.didFailWithError(URLError(.badURL))
            return
        }

        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL

        // Refuse anything that climbs out of the bundled folder. Nothing should
        // ever ask for it, but the handler is reachable from page script.
        guard file.path == root.path || file.path.hasPrefix(root.path + "/"),
              let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": Self.mimeType(for: file.pathExtension),
                "Content-Length": String(data.count),
                "Cache-Control": "no-cache"
            ]
        )!

        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    /// Required by the protocol. Synchronous delivery means there is never an
    /// in-flight task left to cancel.
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js":          return "text/javascript; charset=utf-8"
        case "css":         return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json; charset=utf-8"
        case "svg":         return "image/svg+xml"
        case "png":         return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "ico":         return "image/x-icon"
        case "woff2":       return "font/woff2"
        case "woff":        return "font/woff"
        default:            return "application/octet-stream"
        }
    }
}
