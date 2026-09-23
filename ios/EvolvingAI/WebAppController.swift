import UIKit
import WebKit
import SafariServices

/// The whole app. A full-bleed web view running the same `docs/` the website
/// runs, wrapped in the native behaviour a web view does not get for free:
/// system browser for outside links, haptics on controls, a launch cover so
/// the first frame is never blank, and a scroll view that bounces against the
/// brand colour instead of black.
final class WebAppController: UIViewController {

    private var webView: WKWebView!
    private let cover = UIView()
    private let statusBarBackdrop = UIView()
    private let haptics = Haptics()
    private var didReveal = false

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    /// The web app paints its own background to the screen edges, so the home
    /// indicator should sit over it rather than on a black strip.
    override var prefersHomeIndicatorAutoHidden: Bool { false }

    override func loadView() {
        view = UIView()
        view.backgroundColor = Brand.background
        buildWebView()
        buildStatusBarBackdrop()
        buildCover()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        haptics.prepare()
        installOrganizerGesture()
        webView.load(URLRequest(url: BundleSchemeHandler.baseURL))
    }

    // MARK: - Organizer console

    /// On the website the console is reached by typing `#organizer` on the end
    /// of the URL: deliberately unlinked, so participants never stumble into
    /// it. An app has no address bar, which would have left the console
    /// unreachable here. A long press on the wordmark is the same bargain —
    /// available to anyone who knows, invisible to everyone who does not.
    private func installOrganizerGesture() {
        let press = UILongPressGestureRecognizer(target: self, action: #selector(handleOrganizerPress))
        press.minimumPressDuration = 1.2
        // Claim the touch once recognised. Letting it through sends a click to
        // the console the moment it loads, and the wordmark's own handler —
        // "home from anywhere" — bounces straight back out again.
        //
        // This costs the wordmark's tap nothing: a quick tap never recognises
        // as a long press, so it is never cancelled. `shouldBegin` keeps even
        // that confined to the wordmark, so a long press anywhere else still
        // selects text as usual.
        press.cancelsTouchesInView = true
        press.delaysTouchesBegan = false
        press.delegate = self
        webView.addGestureRecognizer(press)
    }

    @objc private func handleOrganizerPress(_ gesture: UILongPressGestureRecognizer) {
        guard gesture.state == .began else { return }

        haptics.fire("success")

        let inOrganizer = webView.url?.fragment?.contains("organizer") ?? false
        webView.load(URLRequest(url: inOrganizer ? BundleSchemeHandler.baseURL
                                                 : BundleSchemeHandler.organizerURL))
    }


    // MARK: - Construction

    private func buildWebView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)

        // Audio/video is not used, but the default would otherwise take over the
        // screen for any media the readings might embed.
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = .all

        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(
            source: NativeChrome.script,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        ))
        let proxy = ScriptMessageProxy(target: self)
        controller.add(proxy, name: "haptic")
        controller.add(proxy, name: "appReady")
        config.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self

        // Let the page's own background show through, in the colour it uses, so
        // an overscroll bounce reveals the app rather than a black void.
        webView.isOpaque = false
        webView.backgroundColor = Brand.background
        webView.scrollView.backgroundColor = Brand.background

        // The page already handles the notch with `viewport-fit=cover` and
        // `env(safe-area-inset-*)`. Any native inset on top of that double-counts.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.keyboardDismissMode = .interactive

        // A peek-and-pop preview on a citation link is a browser gesture.
        webView.allowsLinkPreview = false
        webView.allowsBackForwardNavigationGestures = false

        webView.alpha = 0
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
    }

    /// An opaque band behind the status bar, the height of the top safe area.
    ///
    /// The page's own header already paints this strip and keeps itself clear
    /// of the clock. But WebKit does not re-pin a `position:sticky` element
    /// while the keyboard is resizing the viewport, so during typing the header
    /// scrolls away and body text runs under the Dynamic Island. iOS Safari
    /// behaves the same way, which is why the website shows it too. A native
    /// band costs nothing — it is the same colour the header paints there — and
    /// it holds in every state the web layer cannot control.
    private func buildStatusBarBackdrop() {
        statusBarBackdrop.backgroundColor = Brand.background
        statusBarBackdrop.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(statusBarBackdrop)
        NSLayoutConstraint.activate([
            statusBarBackdrop.topAnchor.constraint(equalTo: view.topAnchor),
            statusBarBackdrop.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            statusBarBackdrop.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            statusBarBackdrop.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor)
        ])
    }

    /// The same flat brand colour as the launch screen, so the hand-off from
    /// the system launch image to the app is invisible. It lifts only once the
    /// first screen has actually painted.
    private func buildCover() {
        cover.backgroundColor = Brand.background
        cover.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(cover)
        NSLayoutConstraint.activate([
            cover.topAnchor.constraint(equalTo: view.topAnchor),
            cover.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            cover.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            cover.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
    }

    // MARK: - Reveal

    private func reveal() {
        guard !didReveal else { return }
        didReveal = true
        UIView.animate(withDuration: 0.28, delay: 0, options: .curveEaseOut) {
            self.webView.alpha = 1
            self.cover.alpha = 0
        } completion: { _ in
            self.cover.isHidden = true
        }
    }

    // MARK: - Outside links

    /// Citations point at PDFs on arxiv, PNAS, the Royal Society and the Nobel
    /// site. Opening those in the app's own web view would strand the reader in
    /// a chrome-less page with no way back, so they get the system browser —
    /// tinted to match, and dismissible.
    fileprivate func openExternally(_ url: URL) {
        guard let scheme = url.scheme?.lowercased() else { return }

        if scheme == "http" || scheme == "https" {
            let config = SFSafariViewController.Configuration()
            config.barCollapsingEnabled = true
            let safari = SFSafariViewController(url: url, configuration: config)
            safari.preferredBarTintColor = Brand.background
            safari.preferredControlTintColor = Brand.accent
            safari.dismissButtonStyle = .done
            safari.modalPresentationStyle = .pageSheet
            present(safari, animated: true)
        } else {
            // mailto:, tel: and anything else the system owns.
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - Gestures

extension WebAppController: UIGestureRecognizerDelegate {

    /// Confines the organizer long press to the wordmark in the top-left.
    func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
        let point = gesture.location(in: view)
        let top = view.safeAreaInsets.top
        return point.x < 170 && point.y > top && point.y < top + 58
    }

    /// The web view drives scrolling and selection through its own
    /// recognisers; this one has to be allowed to sit alongside them.
    func gestureRecognizer(_ gesture: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        true
    }
}

// MARK: - Navigation

extension WebAppController: WKNavigationDelegate {

    func webView(_ webView: WKWebView,
                 decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {

        guard let url = action.request.url else {
            decisionHandler(.allow)
            return
        }

        // Our own pages, and the in-page navigation the app does with `#`.
        if url.scheme == BundleSchemeHandler.scheme || url.scheme == "about" {
            decisionHandler(.allow)
            return
        }

        // Anything else is somebody else's site.
        decisionHandler(.cancel)
        openExternally(url)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // WebKit restores the previous scroll offset when it loads the same
        // document again, which is right for a browser tab and wrong for an
        // app: it opened mid-page, with the first field's label tucked under
        // the header. Every screen here starts at the top.
        webView.scrollView.setContentOffset(.zero, animated: false)

        // Belt and braces: if the injected `load` handler never fires, the app
        // still appears rather than sitting behind the cover forever.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.reveal() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        reveal()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        reveal()
    }
}

// MARK: - target="_blank"

extension WebAppController: WKUIDelegate {

    /// The reading citations carry `target="_blank"`. WebKit asks for a second
    /// web view to put them in; it gets the system browser instead.
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { openExternally(url) }
        return nil
    }

    /// The web app never calls `alert`, but a native alert beats a silent
    /// no-op if it ever does.
    func webView(_ webView: WKWebView,
                 runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView,
                 runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "Confirm", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
}

// MARK: - Messages from the page

extension WebAppController: WKScriptMessageHandler {

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "appReady": reveal()
        case "haptic":   haptics.fire(message.body as? String ?? "light")
        default:         break
        }
    }
}

/// `WKUserContentController` retains its handlers. Going through a proxy that
/// holds the controller weakly keeps the pair collectable.
private final class ScriptMessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(target: WKScriptMessageHandler) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

/// Taps on the ranking chips and the step buttons are the app's main gesture,
/// and a web view gives them no feedback at all.
private final class Haptics {
    private let impact = UIImpactFeedbackGenerator(style: .light)
    private let notice = UINotificationFeedbackGenerator()

    func prepare() { impact.prepare() }

    func fire(_ kind: String) {
        switch kind {
        case "success": notice.notificationOccurred(.success)
        case "warning": notice.notificationOccurred(.warning)
        case "error":   notice.notificationOccurred(.error)
        default:        impact.impactOccurred(); impact.prepare()
        }
    }
}
