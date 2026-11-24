// @vitest-environment jsdom
/**
 * Inside the iOS app, Face ID goes through the app (lib/auth/native-passkey-bridge →
 * PasskeyHandler.swift), never through the browser's WebAuthn API, which does not reach Face ID in
 * a WKWebView. An app build without the handler offers no Face ID at all. The fake app below
 * answers like PasskeyHandler.swift: an `allfantasy:passkey` event carrying the request id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const browser = vi.hoisted(() => ({
  startAuthentication: vi.fn(async () => ({ id: "from-browser" })),
  startRegistration: vi.fn(async () => ({ id: "from-browser" })),
}))
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  platformAuthenticatorIsAvailable: async () => true,
  startAuthentication: browser.startAuthentication,
  startRegistration: browser.startRegistration,
}))
const nextAuth = vi.hoisted(() => ({ signIn: vi.fn(async () => ({ ok: true, error: undefined })) }))
vi.mock("next-auth/react", () => ({ signIn: nextAuth.signIn }))

import { addPasskey, canUsePasskeys, signInWithPasskey } from "@/lib/auth/passkey-client"

const APP_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 AllFantasyiOS/1.3 AFIAP/1"
const SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1"

const posted: Array<Record<string, string>> = []
let appAnswer: (message: Record<string, string>) => Record<string, unknown>

function installApp() {
  ;(window as any).webkit = {
    messageHandlers: {
      passkey: {
        postMessage: (message: Record<string, string>) => {
          posted.push(message)
          const detail = { requestId: message.requestId, ...appAnswer(message) }
          setTimeout(() => window.dispatchEvent(new CustomEvent("allfantasy:passkey", { detail })), 0)
        },
      },
    },
  }
}

const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
  const u = String(url)
  if (u.endsWith("/signin/options")) return new Response(JSON.stringify({ options: { challenge: "c-signin", rpId: "www.allfantasy.ai" } }))
  if (u.endsWith("/register/options"))
    return new Response(JSON.stringify({ options: { challenge: "c-reg", rp: { id: "www.allfantasy.ai" }, user: { id: "dXNlci0x", name: "linda@example.com" } } }))
  if (u.endsWith("/register/verify")) return new Response(JSON.stringify({ ok: true, body: init?.body }))
  return new Response("{}", { status: 404 })
})

function setUA(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true })
}

beforeEach(() => {
  posted.length = 0
  browser.startAuthentication.mockClear()
  browser.startRegistration.mockClear()
  nextAuth.signIn.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal("fetch", fetchMock)
  appAnswer = (m) =>
    m.action === "authenticate"
      ? { kind: "assertion", credentialId: "cred", clientDataJSON: "cdj", authenticatorData: "ad", signature: "sig", userHandle: "uh" }
      : { kind: "registration", credentialId: "cred", clientDataJSON: "cdj", attestationObject: "att" }
})
afterEach(() => {
  delete (window as any).webkit
  vi.unstubAllGlobals()
})

describe("passkeys inside the iOS app", () => {
  it("offers Face ID only in an app build that has the native handler", async () => {
    setUA(APP_UA)
    expect(await canUsePasskeys()).toBe(false) // 1.2 and earlier: no handler, no button
    installApp()
    expect(await canUsePasskeys()).toBe(true)
  })

  it("signs in through the app, never the browser API, with the server's challenge", async () => {
    setUA(APP_UA)
    installApp()
    expect(await signInWithPasskey()).toEqual({ ok: true })
    expect(browser.startAuthentication).not.toHaveBeenCalled()
    expect(posted).toEqual([expect.objectContaining({ action: "authenticate", challenge: "c-signin", rpId: "www.allfantasy.ai" })])
    const sent = JSON.parse((nextAuth.signIn.mock.calls[0] as any)[1].response)
    expect(sent).toMatchObject({ id: "cred", rawId: "cred", type: "public-key", response: { signature: "sig", authenticatorData: "ad", userHandle: "uh" } })
  })

  it("adds a passkey through the app", async () => {
    setUA(APP_UA)
    installApp()
    expect(await addPasskey()).toEqual({ ok: true })
    expect(browser.startRegistration).not.toHaveBeenCalled()
    expect(posted[0]).toMatchObject({ action: "register", challenge: "c-reg", userId: "dXNlci0x", userName: "linda@example.com" })
    const verifyCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/register/verify"))!
    expect(JSON.parse(String(verifyCall[1]?.body)).response).toMatchObject({ id: "cred", response: { attestationObject: "att" } })
  })

  it("closing the Face ID sheet is a cancel, not an error", async () => {
    setUA(APP_UA)
    installApp()
    appAnswer = () => ({ cancelled: true })
    expect(await signInWithPasskey()).toEqual({ ok: false, cancelled: true })
    expect(nextAuth.signIn).not.toHaveBeenCalled()
  })

  it("Safari on the same iPhone still uses the browser API", async () => {
    setUA(SAFARI_UA)
    installApp() // even if something defined the handler, outside the app it is not used
    await signInWithPasskey()
    expect(browser.startAuthentication).toHaveBeenCalled()
    expect(posted).toEqual([])
  })
})
