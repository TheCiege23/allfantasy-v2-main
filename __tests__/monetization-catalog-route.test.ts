import { describe, expect, it } from "vitest"

import { GET } from "@/app/api/monetization/catalog/route"

describe("GET /api/monetization/catalog", () => {
  it("returns subscription/token catalog and fancred boundary copy", async () => {
    const response = await GET()
    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(Array.isArray(payload?.catalog?.subscriptions)).toBe(true)
    expect(Array.isArray(payload?.catalog?.tokenPacks)).toBe(true)
    // 4 tiers (Pro, Commissioner, Legacy, Supreme) × monthly/yearly — All-Access retired.
    expect(payload.catalog.subscriptions.length).toBe(8)
    expect(payload.catalog.tokenPacks.length).toBe(3)
    expect(typeof payload.catalog.subscriptions[0]?.stripePriceConfigured).toBe("boolean")
    expect(String(payload?.fancredBoundary?.short ?? "").toLowerCase()).toContain("fancred")
  })
})
