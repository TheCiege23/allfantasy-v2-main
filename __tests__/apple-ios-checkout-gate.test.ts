import { describe, expect, it } from "vitest"
import { isAppleIosShellRequest } from "@/lib/monetization/isAppleIosShellRequest"

const APP_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"

describe("iOS app Stripe checkout gate", () => {
  it("blocks a 1.0 app build (no StoreKit bridge)", () => {
    const request = new Request("https://www.allfantasy.ai/api/monetization/checkout/tokens", {
      headers: { "user-agent": `${APP_UA} AllFantasyiOS/1.0` },
    })
    expect(isAppleIosShellRequest(request)).toBe(true)
  })

  it("blocks an IAP build too — it buys through Apple, never Stripe", () => {
    const request = new Request("https://www.allfantasy.ai/api/monetization/checkout/subscription", {
      headers: { "user-agent": `${APP_UA} AllFantasyiOS/1.1 AFIAP/1` },
    })
    expect(isAppleIosShellRequest(request)).toBe(true)
  })

  it("keeps ordinary Safari checkout available", () => {
    const request = new Request("https://www.allfantasy.ai/api/monetization/checkout/tokens", {
      headers: { "user-agent": "Mozilla/5.0 (iPhone) Safari/604.1" },
    })
    expect(isAppleIosShellRequest(request)).toBe(false)
  })
})
