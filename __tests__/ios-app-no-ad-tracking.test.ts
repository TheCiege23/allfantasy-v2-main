// @vitest-environment jsdom
/**
 * Inside the iOS app no ad tracking runs (App Store guideline 5.1.2: tracking
 * needs an App Tracking Transparency prompt the app does not show). That is
 * what lets App Privacy say "Data Not Used to Track You" truthfully, so it is
 * asserted on BEHAVIOUR — does a request reach Meta, does the pixel script get
 * injected — with the website case beside each as the control that proves the
 * path is live at all.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

vi.mock("@/lib/analytics/recordAnalyticsEvent", () => ({ recordAnalyticsEvent: vi.fn(async () => undefined) }))

import { sendMetaCAPIEvent } from "@/lib/meta-capi"
import { ensureMetaPixel } from "@/lib/meta-client"
import { IOS_APP_UA_TEST_JS, isInIosAppClient } from "@/lib/platform/iosApp"
import { AD_OPT_OUT_TEST_JS } from "@/lib/privacy/adMeasurementOptOut"

const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 AllFantasyiOS/1.0"
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1"

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", { value: ua, configurable: true })
}

const savedToken = process.env.META_CONVERSIONS_API_TOKEN
const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 }))

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy)
  fetchSpy.mockClear()
  process.env.META_CONVERSIONS_API_TOKEN = "test-capi-token-not-real"
  document.head.innerHTML = ""
  document.body.innerHTML = "<script></script>"
  delete (window as { fbq?: unknown }).fbq
  delete (window as { _fbq?: unknown })._fbq
  delete (window as { __afMetaPixelIds?: unknown }).__afMetaPixelIds
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (savedToken === undefined) delete process.env.META_CONVERSIONS_API_TOKEN
  else process.env.META_CONVERSIONS_API_TOKEN = savedToken
})

const event = (ua: string) => ({
  eventName: "CompleteRegistration",
  eventId: "evt-1",
  email: "person@example.com",
  request: new Request("https://www.allfantasy.ai/api/auth/register", { method: "POST", headers: { "user-agent": ua } }),
})

describe("Meta Conversions API (server)", () => {
  it("control: a website signup is sent to Meta", async () => {
    await sendMetaCAPIEvent(event(SAFARI_UA))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toContain("graph.facebook.com")
  })

  it("an iOS-app signup is never sent — read from the request", async () => {
    const res = await sendMetaCAPIEvent(event(IOS_UA))
    expect(res).toEqual({ success: false, error: "skipped_ios_app" })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("an iOS-app signup is never sent — read from an explicit clientUserAgent", async () => {
    await sendMetaCAPIEvent({ eventName: "Lead", eventId: "evt-2", clientUserAgent: IOS_UA })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("Meta Pixel (browser)", () => {
  const pixelScripts = () =>
    Array.from(document.getElementsByTagName("script")).filter((s) => s.src.includes("connect.facebook.net"))

  it("control: on the website the pixel script is injected and fbq exists", () => {
    setUserAgent(SAFARI_UA)
    expect(ensureMetaPixel("1234567890")).toBe(true)
    expect(pixelScripts()).toHaveLength(1)
  })

  it("in the app nothing is injected and fbq is never created", () => {
    setUserAgent(IOS_UA)
    expect(ensureMetaPixel("1234567890")).toBe(false)
    expect(pixelScripts()).toHaveLength(0)
    expect((window as { fbq?: unknown }).fbq).toBeUndefined()
  })
})

describe("inline loaders in the root layout (GTM, Google tag, Meta Pixel)", () => {
  it("the shared UA test is right in both directions", () => {
    setUserAgent(IOS_UA)
    expect(new Function(`return ${IOS_APP_UA_TEST_JS}`)()).toBe(true)
    expect(isInIosAppClient()).toBe(true)
    setUserAgent(SAFARI_UA)
    expect(new Function(`return ${IOS_APP_UA_TEST_JS}`)()).toBe(false)
    expect(isInIosAppClient()).toBe(false)
  })

  it("every tracking loader is behind it", () => {
    const src = readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8")
    // GTM carries the Meta, TikTok and Reddit pixels in production.
    // Each loader also carries the "Do Not Sell or Share" guard (lib/privacy/adMeasurementOptOut).
    expect(src).toMatch(/if \(!\$\{IOS_APP_UA_TEST_JS\} && !\(\$\{AD_OPT_OUT_TEST_JS\}\)\) \(function\(w,d,s,l,i\)\{/)
    // Google tag: loaded by the guarded inline script, never by a <Script src>.
    expect(src).not.toMatch(/<Script\s+src=\{`https:\/\/www\.googletagmanager\.com\/gtag/)
    expect(src).toMatch(/id="google-gtag"[\s\S]{0,120}if \(!\$\{IOS_APP_UA_TEST_JS\} && !\(\$\{AD_OPT_OUT_TEST_JS\}\)\)/)
    // Both Meta Pixel bootstraps.
    expect(src).toContain("if (!pixelId || ${IOS_APP_UA_TEST_JS} || ${AD_OPT_OUT_TEST_JS}) return;")
    expect(src).toMatch(/id="meta-pixel-base"[\s\S]{0,80}if \(!\$\{IOS_APP_UA_TEST_JS\} && !\(\$\{AD_OPT_OUT_TEST_JS\}\)\) \{/)
  })

  it("the guarded GTM loader really does nothing in the app, and runs on the website", () => {
    const src = readFileSync(path.join(process.cwd(), "app/layout.tsx"), "utf8")
    const loader = /\{`(if \(!\$\{IOS_APP_UA_TEST_JS\} && !\(\$\{AD_OPT_OUT_TEST_JS\}\)\) \(function\(w,d,s,l,i\)[\s\S]*?)`\}/.exec(src)?.[1]
    expect(loader).toBeTruthy()
    const run = (ua: string) => {
      setUserAgent(ua)
      document.head.innerHTML = ""
      document.body.innerHTML = "<script></script>"
      delete (window as { dataLayer?: unknown }).dataLayer
      const js = loader!
        .replace("${IOS_APP_UA_TEST_JS}", IOS_APP_UA_TEST_JS)
        .replace("${AD_OPT_OUT_TEST_JS}", AD_OPT_OUT_TEST_JS)
        .replace("${gtmId}", "GTM-TEST")
      new Function(js)()
      return Array.from(document.getElementsByTagName("script")).filter((s) => s.src.includes("googletagmanager.com/gtm.js"))
    }
    expect(run(SAFARI_UA)).toHaveLength(1)
    expect(run(IOS_UA)).toHaveLength(0)
    // Global Privacy Control on the website: the container never loads.
    Object.defineProperty(window.navigator, "globalPrivacyControl", { value: true, configurable: true })
    expect(run(SAFARI_UA)).toHaveLength(0)
    Object.defineProperty(window.navigator, "globalPrivacyControl", { value: undefined, configurable: true })
    expect(run(SAFARI_UA)).toHaveLength(1)
  })
})
