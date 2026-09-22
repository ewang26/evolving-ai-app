import UIKit

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = WebAppController()

        // The web app has one palette and it is dark. Pinning the window to
        // dark keeps the parts iOS draws for itself — the keyboard, the text
        // selection menu, the share sheet — in the same register, instead of a
        // white keyboard sliding up under a navy form.
        window.overrideUserInterfaceStyle = .dark
        window.backgroundColor = Brand.background

        self.window = window
        window.makeKeyAndVisible()
    }
}
