import UIKit
import WebKit
import StoreKit

var webView: WKWebView! = nil

class ViewController: UIViewController, WKNavigationDelegate, UIDocumentInteractionControllerDelegate {
    private let appleProductIDs: Set<String> = [
        "af_pro_monthly", "af_pro_yearly", "af_commissioner_monthly", "af_commissioner_yearly",
        "af_war_room_monthly", "af_war_room_yearly", "af_supreme_monthly", "af_supreme_yearly",
        "af_tokens_5", "af_tokens_10", "af_tokens_25"
    ]
    private var pendingAppleTransactions: [UInt64: Transaction] = [:]

    private func sendAppleResult(_ detail: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(detail),
              let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return }
        AllFantasy.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('allfantasy:apple-iap', {detail: \(json)}))", completionHandler: nil)
    }

    private func handleAppleIAP(_ message: WKScriptMessage) {
        // Other pages opened in the web view must never initiate a purchase.
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == "https",
              message.frameInfo.securityOrigin.host == "www.allfantasy.ai",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String,
              let requestId = body["requestId"] as? String else { return }

        Task { @MainActor in
            do {
                if action == "finish" {
                    guard let transactionId = body["transactionId"] as? String,
                          let id = UInt64(transactionId) else { return }
                    if let transaction = pendingAppleTransactions.removeValue(forKey: id) {
                        await transaction.finish()
                    }
                    return
                }
                if action == "products" {
                    let products = try await Product.products(for: appleProductIDs)
                    sendAppleResult(["requestId": requestId, "products": products.map {
                        ["id": $0.id, "displayPrice": $0.displayPrice, "displayName": $0.displayName]
                    }])
                    return
                }
                if action == "manage" {
                    guard let scene = view.window?.windowScene else {
                        sendAppleResult(["requestId": requestId, "error": "Subscription settings are unavailable."])
                        return
                    }
                    try await AppStore.showManageSubscriptions(in: scene)
                    sendAppleResult(["requestId": requestId])
                    return
                }
                if action == "restore" {
                    try await AppStore.sync()
                    var transactions: [[String: String]] = []
                    var seen: Set<UInt64> = []
                    for await result in Transaction.currentEntitlements {
                        if case .verified(let transaction) = result,
                           appleProductIDs.contains(transaction.productID),
                           seen.insert(transaction.id).inserted {
                            transactions.append(["productId": transaction.productID,
                                                 "transactionId": String(transaction.id),
                                                 "signedTransactionInfo": result.jwsRepresentation])
                        }
                    }
                    // Consumables are absent from currentEntitlements. Recover purchases
                    // that were not finished because account verification failed or the app closed.
                    for await result in Transaction.unfinished {
                        if case .verified(let transaction) = result,
                           appleProductIDs.contains(transaction.productID),
                           seen.insert(transaction.id).inserted {
                            pendingAppleTransactions[transaction.id] = transaction
                            transactions.append(["productId": transaction.productID,
                                                 "transactionId": String(transaction.id),
                                                 "signedTransactionInfo": result.jwsRepresentation])
                        }
                    }
                    sendAppleResult(["requestId": requestId, "transactions": transactions])
                    return
                }
                guard action == "purchase",
                      let productId = body["productId"] as? String,
                      appleProductIDs.contains(productId),
                      let accountTokenText = body["appAccountToken"] as? String,
                      let accountToken = UUID(uuidString: accountTokenText),
                      let product = try await Product.products(for: [productId]).first else {
                    sendAppleResult(["requestId": requestId, "error": "This Apple product is unavailable."])
                    return
                }
                let purchase = try await product.purchase(options: [.appAccountToken(accountToken)])
                switch purchase {
                case .success(let result):
                    guard case .verified(let transaction) = result else {
                        sendAppleResult(["requestId": requestId, "error": "Apple could not verify the purchase."])
                        return
                    }
                    pendingAppleTransactions[transaction.id] = transaction
                    // The web client verifies and grants the transaction on our server before finish.
                    sendAppleResult(["requestId": requestId, "productId": transaction.productID,
                                     "transactionId": String(transaction.id),
                                     "signedTransactionInfo": result.jwsRepresentation])
                case .userCancelled:
                    sendAppleResult(["requestId": requestId, "cancelled": true])
                case .pending:
                    sendAppleResult(["requestId": requestId, "error": "Purchase is pending Apple approval."])
                @unknown default:
                    sendAppleResult(["requestId": requestId, "error": "Unable to complete purchase."])
                }
            } catch {
                sendAppleResult(["requestId": requestId, "error": error.localizedDescription])
            }
        }
    }
    enum LoadingMode {
        case defaultCachePolicy
        case forceCache
    }

    var documentController: UIDocumentInteractionController?
    func documentInteractionControllerViewControllerForPreview(_ controller: UIDocumentInteractionController) -> UIViewController {
        return self
    }

    @IBOutlet weak var loadingView: UIView!
    @IBOutlet weak var progressView: UIProgressView!
    @IBOutlet weak var connectionProblemView: UIImageView!
    @IBOutlet weak var webviewView: UIView!
    var toolbarView: UIToolbar!

    var htmlIsLoaded = false;
    private var loadingMode = LoadingMode.defaultCachePolicy

    private var themeObservation: NSKeyValueObservation?
    var currentWebViewTheme: UIUserInterfaceStyle = .unspecified
    override var preferredStatusBarStyle : UIStatusBarStyle {
        if #available(iOS 13, *), overrideStatusBar{
            if #available(iOS 15, *) {
                return .default
            } else {
                return statusBarTheme == "dark" ? .lightContent : .darkContent
            }
        }
        return .default
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        initWebView()
        initToolbarView()
        loadRootUrl()

        NotificationCenter.default.addObserver(self, selector: #selector(self.keyboardWillHide(_:)), name: UIResponder.keyboardWillHideNotification , object: nil)

    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        AllFantasy.webView.frame = calcWebviewFrame(webviewView: webviewView, toolbarView: nil)
    }

    @objc func keyboardWillHide(_ notification: NSNotification) {
        AllFantasy.webView.setNeedsLayout()
    }

    func initWebView() {
        AllFantasy.webView = createWebView(container: webviewView, WKSMH: self, WKND: self, NSO: self, VC: self)
        webviewView.addSubview(AllFantasy.webView);

        AllFantasy.webView.uiDelegate = self;

        AllFantasy.webView.addObserver(self, forKeyPath: #keyPath(WKWebView.estimatedProgress), options: .new, context: nil)

        if(pullToRefresh){
            let refreshControl = UIRefreshControl()
            refreshControl.addTarget(self, action: #selector(refreshWebView(_:)), for: UIControl.Event.valueChanged)
            AllFantasy.webView.scrollView.addSubview(refreshControl)
            AllFantasy.webView.scrollView.bounces = true
        }

        if #available(iOS 15.0, *), adaptiveUIStyle {
            themeObservation = AllFantasy.webView.observe(\.themeColor) { [unowned self] webView, _ in
                let backgroundColor = AllFantasy.webView.underPageBackgroundColor;
                let themeColor = AllFantasy.webView.themeColor;
                currentWebViewTheme = themeColor?.isLight() ?? backgroundColor?.isLight() ?? true ? .light : .dark
                self.overrideUIStyle()
                view.backgroundColor = themeColor ?? backgroundColor;
            }
        }
    }

    @objc func refreshWebView(_ sender: UIRefreshControl) {
        AllFantasy.webView?.reload()
        sender.endRefreshing()
    }

    func createToolbarView() -> UIToolbar{
        let winScene = UIApplication.shared.connectedScenes.first
        let windowScene = winScene as! UIWindowScene
        var statusBarHeight = windowScene.statusBarManager?.statusBarFrame.height ?? 60

        #if targetEnvironment(macCatalyst)
        if (statusBarHeight == 0){
            statusBarHeight = 30
        }
        #endif

        let toolbarView = UIToolbar(frame: CGRect(x: 0, y: 0, width: webviewView.frame.width, height: 0))
        toolbarView.sizeToFit()
        toolbarView.frame = CGRect(x: 0, y: 0, width: webviewView.frame.width, height: toolbarView.frame.height + statusBarHeight)
//        toolbarView.autoresizingMask = [.flexibleTopMargin, .flexibleRightMargin, .flexibleWidth]

        let flex = UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
        let close = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(loadRootUrl))
        toolbarView.setItems([close,flex], animated: true)

        toolbarView.isHidden = true

        return toolbarView
    }

    func overrideUIStyle(toDefault: Bool = false) {
        if #available(iOS 15.0, *), adaptiveUIStyle {
            if (((htmlIsLoaded && !AllFantasy.webView.isHidden) || toDefault) && self.currentWebViewTheme != .unspecified) {
                UIApplication
                    .shared
                    .connectedScenes
                    .flatMap { ($0 as? UIWindowScene)?.windows ?? [] }
                    .first { $0.isKeyWindow }?.overrideUserInterfaceStyle = toDefault ? .unspecified : self.currentWebViewTheme;
            }
        }
    }

    func initToolbarView() {
        toolbarView =  createToolbarView()

        webviewView.addSubview(toolbarView)
    }

    @objc func loadRootUrl(cachePolicy: NSURLRequest.CachePolicy = .useProtocolCachePolicy) {
        AllFantasy.webView.load(URLRequest(url: SceneDelegate.universalLinkToLaunch ?? SceneDelegate.shortcutLinkToLaunch ?? rootUrl, cachePolicy: cachePolicy))
    }

    func reloadWebview(
        loadingMode: LoadingMode = LoadingMode.defaultCachePolicy
    ) {
        switch loadingMode {
        case LoadingMode.defaultCachePolicy:
            loadRootUrl(cachePolicy: .useProtocolCachePolicy);

        case LoadingMode.forceCache:
            loadRootUrl(cachePolicy: .useProtocolCachePolicy);
        }

        self.loadingMode = loadingMode
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!){
        htmlIsLoaded = true

        self.setProgress(1.0, true)
        self.animateConnectionProblem(false)

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
            AllFantasy.webView.isHidden = false
            self.loadingView.isHidden = true

            self.setProgress(0.0, false)

            self.overrideUIStyle()
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        htmlIsLoaded = false;

        if (error as NSError)._code == (-999) { return }
        if (error as NSError)._code == 102 { return }

        self.overrideUIStyle(toDefault: true);
        webView.isHidden = true;
        loadingView.isHidden = false;

        if loadingMode == LoadingMode.defaultCachePolicy {
            DispatchQueue.main.async {
                self.reloadWebview(loadingMode: LoadingMode.forceCache)
            }
        } else {
            animateConnectionProblem(true);
            setProgress(0.05, true);

            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                self.setProgress(0.1, true);
                DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                    self.reloadWebview()
                }
            }
        }
    }

    override func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey : Any]?, context: UnsafeMutableRawPointer?) {

        if (keyPath == #keyPath(WKWebView.estimatedProgress) &&
                AllFantasy.webView.isLoading &&
                !self.loadingView.isHidden &&
                !self.htmlIsLoaded) {
                    var progress = Float(AllFantasy.webView.estimatedProgress);

                    if (progress >= 0.8) { progress = 1.0; };
                    if (progress >= 0.3) { self.animateConnectionProblem(false); }

                    self.setProgress(progress, true);
        }
    }

    func setProgress(_ progress: Float, _ animated: Bool) {
        self.progressView.setProgress(progress, animated: animated);
    }


    func animateConnectionProblem(_ show: Bool) {
        if (show) {
            self.connectionProblemView.isHidden = false;
            self.connectionProblemView.alpha = 0
            UIView.animate(withDuration: 0.7, delay: 0, options: [.repeat, .autoreverse], animations: {
                self.connectionProblemView.alpha = 1
            })
        }
        else {
            UIView.animate(withDuration: 0.3, delay: 0, options: [], animations: {
                self.connectionProblemView.alpha = 0 // Here you will get the animation you want
            }, completion: { _ in
                self.connectionProblemView.isHidden = true;
                self.connectionProblemView.layer.removeAllAnimations();
            })
        }
    }

    deinit {
        AllFantasy.webView.removeObserver(self, forKeyPath: #keyPath(WKWebView.estimatedProgress))
    }
}

extension UIColor {
    // Check if the color is light or dark, as defined by the injected lightness threshold.
    // Some people report that 0.7 is best. I suggest to find out for yourself.
    // A nil value is returned if the lightness couldn't be determined.
    func isLight(threshold: Float = 0.5) -> Bool? {
        let originalCGColor = self.cgColor

        // Now we need to convert it to the RGB colorspace. UIColor.white / UIColor.black are greyscale and not RGB.
        // If you don't do this then you will crash when accessing components index 2 below when evaluating greyscale colors.
        let RGBCGColor = originalCGColor.converted(to: CGColorSpaceCreateDeviceRGB(), intent: .defaultIntent, options: nil)
        guard let components = RGBCGColor?.components else {
            return nil
        }
        guard components.count >= 3 else {
            return nil
        }

        let brightness = Float(((components[0] * 299) + (components[1] * 587) + (components[2] * 114)) / 1000)
        return (brightness > threshold)
    }
}

extension ViewController: WKScriptMessageHandler {
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "apple-iap" {
            handleAppleIAP(message)
            return
        }
        if message.name == "print" {
            printView(webView: AllFantasy.webView)
        }
        if message.name == "push-subscribe" {
            handleSubscribeTouch(message: message)
        }
        if message.name == "push-permission-request" {
            handlePushPermission()
        }
        if message.name == "push-permission-state" {
            handlePushState()
        }
        if message.name == "push-token" {
            handleFCMToken()
        }
  }
}
