import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { purchaseWithGooglePlay, restoreGooglePlayPurchases } from "@/lib/monetization/google-play-client"
const detail = { itemId: "af_pro_monthly", price: { currency: "USD", value: "9.99" }, subscriptionPeriod: "P1M" }
const token = "private-test-purchase-receipt"
const api = { getDetails: vi.fn(), listPurchases: vi.fn() }
const complete = vi.fn(), show = vi.fn()
let enabled = true, verifyStatus = 200
const fetchMock = vi.fn(async (url: string) => {
  if (url.endsWith("/products")) return Response.json({ enabled, products: [{ sku: "af_pro_monthly", productId: "af_pro_monthly", type: "subscription", interval: "month" }] })
  if (url.endsWith("/intents")) return Response.json({ intentId: "c9de2a48-4bc1-4ec6-ae13-35f1c7b062e4", ownerId: "purchase-account" })
  return Response.json(verifyStatus === 200 ? { ok: true } : { error: "Verification unavailable" }, { status: verifyStatus })
})
beforeEach(() => {
  localStorage.clear(); enabled = true; verifyStatus = 200
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockClear()
  api.getDetails.mockReset().mockResolvedValue([detail]); api.listPurchases.mockReset().mockResolvedValue([])
  complete.mockReset().mockResolvedValue(undefined); show.mockReset().mockResolvedValue({ details: { purchaseToken: token }, complete })
  vi.stubGlobal("PaymentRequest", class { show = show })
  Object.defineProperty(window, "getDigitalGoodsService", { configurable: true, value: async () => api })
})
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); delete (window as any).getDigitalGoodsService })
describe("Google Play checkout and recovery", () => {
  it("verifies the receipt before completing checkout", async () => {
    await purchaseWithGooglePlay("af_pro_monthly")
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(["/api/monetization/google-play/products", "/api/monetization/google-play/intents", "/api/monetization/google-play/transactions"])
    expect(complete).toHaveBeenCalledWith("success")
    expect(localStorage.getItem("af:play:pending:v1")).toBe("[]")
  })
  it("does not open a payment when readiness is disabled", async () => {
    enabled = false
    await expect(purchaseWithGooglePlay("af_pro_monthly")).rejects.toThrow(/not available/)
    expect(show).not.toHaveBeenCalled()
  })
  it("refuses a mismatched billing interval before payment", async () => {
    api.getDetails.mockResolvedValue([{ ...detail, subscriptionPeriod: "P1Y" }])
    await expect(purchaseWithGooglePlay("af_pro_monthly")).rejects.toThrow(/interval/)
    expect(show).not.toHaveBeenCalled()
  })
  it("persists a failed verification and restores it without a second payment", async () => {
    verifyStatus = 503
    await expect(purchaseWithGooglePlay("af_pro_monthly")).rejects.toThrow(/unavailable/)
    expect(localStorage.getItem("af:play:pending:v1")).toContain(token)
    verifyStatus = 200
    expect(await restoreGooglePlayPurchases()).toBe(1)
    expect(show).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem("af:play:pending:v1")).toBe("[]")
  })
  it("never starts two payment sheets from overlapping clicks", async () => {
    const first = purchaseWithGooglePlay("af_pro_monthly")
    await expect(purchaseWithGooglePlay("af_pro_monthly")).rejects.toThrow(/in progress/)
    await first
    expect(show).toHaveBeenCalledTimes(1)
  })
  it("canceling does not verify or fulfill any purchase", async () => {
    show.mockRejectedValue(new DOMException("cancelled", "AbortError"))
    await expect(purchaseWithGooglePlay("af_pro_monthly")).rejects.toThrow(/cancelled/)
    expect(fetchMock.mock.calls.some(c => c[0].endsWith("/transactions"))).toBe(false)
    expect(localStorage.getItem("af:play:pending:v1")).toBe("[]")
  })
  it("uses active purchases for restore and propagates account conflicts", async () => {
    api.listPurchases.mockResolvedValue([{ itemId: "af_pro_monthly", purchaseToken: token }]); verifyStatus = 409
    await expect(restoreGooglePlayPurchases()).rejects.toThrow(/original AllFantasy account/)
    expect(show).not.toHaveBeenCalled()
  })
})
