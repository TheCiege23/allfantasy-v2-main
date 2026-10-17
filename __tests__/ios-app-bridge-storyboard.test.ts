import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 🛑 "NOTHING HAPPENS WHEN I CLICK BUY" (owner, 2026-10-03, TestFlight build 12).
 *
 * The Apple in-app purchase handler (`AppleIAPHandler`, `messageHandlers["apple-iap"]`) and the
 * Career widget plugin are registered in `AppBridgeViewController.capacitorDidLoad()`. But
 * `Main.storyboard` still launched Capacitor's stock `CAPBridgeViewController`, so that override
 * never ran: the app compiled the handler, shipped it, and never attached it. The website saw no
 * bridge and every Buy button went nowhere. Nothing failed to build and no test noticed, because
 * the class name lives in a storyboard, not in code anything typechecks.
 *
 * Structural, because that is what the bug was: the storyboard names the class iOS instantiates.
 */
const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('the iOS app launches the bridge that registers in-app purchase', () => {
  it('Main.storyboard instantiates AppBridgeViewController from the App module', () => {
    const storyboard = read('ios-app/ios/App/App/Base.lproj/Main.storyboard')
    expect(storyboard).toMatch(/customClass="AppBridgeViewController"\s+customModule="App"\s+customModuleProvider="target"/)
    expect(storyboard).not.toContain('customClass="CAPBridgeViewController"')
  })

  it('AppBridgeViewController is the class that registers the apple-iap handler', () => {
    const bridge = read('ios-app/ios/App/App/AppBridgeViewController.swift')
    expect(bridge).toMatch(/class AppBridgeViewController\s*:\s*CAPBridgeViewController/)
    expect(bridge).toContain('override func capacitorDidLoad()')
    expect(bridge).toContain('userContentController.add(appleIAP, name: AppleIAPHandler.messageName)')
  })

  it('the class the storyboard names is compiled into the app target', () => {
    const pbx = read('ios-app/ios/App/App.xcodeproj/project.pbxproj')
    expect(pbx).toContain('AppBridgeViewController.swift in Sources')
  })
})
