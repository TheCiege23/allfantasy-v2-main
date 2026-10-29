// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { hasTrustedPlayOrigin } from "@/lib/google-play/billingRequest"
afterEach(() => vi.unstubAllEnvs())
function request(origin?: string, url = "http://0.0.0.0:8080/api/monetization/google-play/intents") {
  return new Request(url, { method: "POST", headers: { ...(origin ? { origin } : {}), "x-forwarded-host": "attacker.invalid" } })
}
describe("Play checkout behind the Railway proxy", () => {
  it("accepts both owned production origins when the route URL is the internal bind address", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.allfantasy.ai")
    vi.stubEnv("PUBLIC_SITE_URL", "https://www.allfantasy.ai")
    expect(hasTrustedPlayOrigin(request("https://www.allfantasy.ai"))).toBe(true)
    expect(hasTrustedPlayOrigin(request("https://allfantasy.ai"))).toBe(true)
  })
  it.each([undefined, "null", "https://attacker.invalid", "https://allfantasy.ai.attacker.invalid", "http://0.0.0.0:8080"])("rejects the untrusted origin %s", origin => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.allfantasy.ai")
    vi.stubEnv("PUBLIC_SITE_URL", "https://www.allfantasy.ai")
    expect(hasTrustedPlayOrigin(request(origin))).toBe(false)
  })
  it("keeps an explicitly configured preview origin", () => {
    vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("VERCEL_BRANCH_URL", "billing-preview.vercel.app")
    expect(hasTrustedPlayOrigin(request("https://billing-preview.vercel.app"))).toBe(true)
  })
})
