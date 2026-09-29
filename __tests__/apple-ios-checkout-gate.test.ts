import { describe, expect, it } from "vitest"
import { isAppleIosShellRequest } from "@/lib/monetization/isAppleIosShellRequest"

describe("PWABuilder iOS checkout gate", () => {
  it("blocks the app shell by user agent", () => {
    const request = new Request("https://www.allfantasy.ai/api/monetization/checkout/tokens", {
      headers: { "user-agent": "Mozilla/5.0 (iPhone) PWAShell" },
    })
    expect(isAppleIosShellRequest(request)).toBe(true)
  })

  it("blocks the app shell by its platform cookie", () => {
    const request = new Request("https://www.allfantasy.ai/api/monetization/checkout/subscription", {
      headers: { cookie: "session=a; app-platform=iOS%20App%20Store" },
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
