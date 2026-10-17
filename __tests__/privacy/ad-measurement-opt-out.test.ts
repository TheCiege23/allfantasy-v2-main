// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/*
 * "Do Not Sell or Share" (Privacy Policy 5.3). Asserted on BEHAVIOUR — does a request reach
 * Meta — with a control beside each case proving the send path is live at all, the same shape
 * as __tests__/ios-app-no-ad-tracking.test.ts.
 */

const { isUserAdOptedOut, setUserAdOptOut } = vi.hoisted(() => ({
  isUserAdOptedOut: vi.fn(async () => false),
  setUserAdOptOut: vi.fn(async () => true),
}))
vi.mock("@/lib/privacy/adOptOutStore", () => ({ isUserAdOptedOut, setUserAdOptOut }))
vi.mock("@/lib/analytics/recordAnalyticsEvent", () => ({ recordAnalyticsEvent: vi.fn(async () => undefined) }))

import { sendMetaCAPIEvent } from "@/lib/meta-capi"
import {
  AD_OPT_OUT_TEST_JS,
  isAdOptOutRequest,
  readAdOptOut,
  withAdOptOut,
} from "@/lib/privacy/adMeasurementOptOut"

const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ events_received: 1 }), { status: 200 }))
const savedToken = process.env.META_CONVERSIONS_API_TOKEN

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy)
  fetchSpy.mockClear()
  isUserAdOptedOut.mockReset().mockResolvedValue(false)
  setUserAdOptOut.mockClear()
  process.env.META_CONVERSIONS_API_TOKEN = "test-capi-token-not-real"
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (savedToken === undefined) delete process.env.META_CONVERSIONS_API_TOKEN
  else process.env.META_CONVERSIONS_API_TOKEN = savedToken
  document.cookie = "af_ad_optout=; Max-Age=0; Path=/"
})

const SAFARI = "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.6 Safari/604.1"
const request = (headers: Record<string, string> = {}) =>
  new Request("https://www.allfantasy.ai/api/auth/register", { method: "POST", headers: { "user-agent": SAFARI, ...headers } })

describe("Conversions API respects the opt-out", () => {
  it("control: a website event with no opt-out is sent", async () => {
    await sendMetaCAPIEvent({ eventName: "Lead", eventId: "e1", userId: "u1", request: request() })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it("Sec-GPC: 1 stops the send, and records the opt-out on the signed-in account", async () => {
    const res = await sendMetaCAPIEvent({ eventName: "Lead", eventId: "e2", userId: "u1", request: request({ "sec-gpc": "1" }) })
    expect(res).toEqual({ success: false, error: "skipped_ad_opt_out" })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(setUserAdOptOut).toHaveBeenCalledWith("u1", { source: "gpc" })
  })

  it("the af_ad_optout cookie stops the send without touching the account", async () => {
    await sendMetaCAPIEvent({ eventName: "Lead", eventId: "e3", userId: "u1", request: request({ cookie: "a=b; af_ad_optout=1" }) })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(setUserAdOptOut).not.toHaveBeenCalled()
  })

  it("an account opt-out stops a server-side event that has no browser (a purchase webhook)", async () => {
    isUserAdOptedOut.mockResolvedValue(true)
    const res = await sendMetaCAPIEvent({ eventName: "Purchase", eventId: "e4", userId: "u1" })
    expect(res.error).toBe("skipped_ad_opt_out")
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("the signal itself", () => {
  it("reads Sec-GPC and the cookie, and nothing else", () => {
    expect(isAdOptOutRequest(new Headers({ "sec-gpc": "1" }))).toBe(true)
    expect(isAdOptOutRequest(new Headers({ cookie: "af_ad_optout=1" }))).toBe(true)
    expect(isAdOptOutRequest(new Headers({ cookie: "af_ad_optout=0; x_af_ad_optout=1" }))).toBe(false)
    expect(isAdOptOutRequest(new Headers({ "sec-gpc": "0" }))).toBe(false)
    expect(isAdOptOutRequest(null)).toBe(false)
  })

  /* The inline expression app/layout.tsx splices into every ad-tag guard. */
  it("the layout guard expression is true for GPC or the cookie, false otherwise", () => {
    const evaluate = () => new Function(`return Boolean(${AD_OPT_OUT_TEST_JS})`)() as boolean
    expect(evaluate()).toBe(false)
    document.cookie = "af_ad_optout=1; Path=/"
    expect(evaluate()).toBe(true)
    document.cookie = "af_ad_optout=; Max-Age=0; Path=/"
    Object.defineProperty(window.navigator, "globalPrivacyControl", { value: true, configurable: true })
    expect(evaluate()).toBe(true)
    Object.defineProperty(window.navigator, "globalPrivacyControl", { value: undefined, configurable: true })
    expect(evaluate()).toBe(false)
  })

  it("the account record merges into notificationPreferences and keeps the SMS consent beside it", () => {
    const prefs = { smsConsent: { consentedAt: "2026-09-01T00:00:00Z" }, dashboardToggles: { a: true } }
    const out = withAdOptOut(prefs, { source: "settings", at: new Date("2026-10-06T00:00:00Z") })
    expect(out.smsConsent).toEqual(prefs.smsConsent)
    expect(out.dashboardToggles).toEqual(prefs.dashboardToggles)
    expect(readAdOptOut(out)).toEqual({ optedOutAt: "2026-10-06T00:00:00.000Z", source: "settings" })
    const back = withAdOptOut(out, null)
    expect(readAdOptOut(back)).toBeNull()
    expect(back.smsConsent).toEqual(prefs.smsConsent)
  })
})
