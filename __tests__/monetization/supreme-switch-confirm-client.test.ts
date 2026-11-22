// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import { resolveCheckoutUrl } from "@/lib/monetization/checkout-client"

/**
 * Supreme over Pro / Commissioner switches the plan in place and charges the card on file, with no Checkout
 * page between the click and the charge. So the server answers the first request with `confirm_switch`, and
 * the client sends `confirmSwitch: true` only after the buyer says yes.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const ASK = {
  code: "confirm_switch",
  message: "Switch your AF Pro plan to AF Supreme? Your card on file is charged the difference …",
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("switching to Supreme from the web", () => {
  it("asks with the server's sentence, then confirms and lands on the success page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(409, ASK))
      .mockResolvedValueOnce(json(200, { url: "/upgrade?checkout=success&switched=1", switched: true }))
    vi.stubGlobal("fetch", fetchMock)
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true)

    const result = await resolveCheckoutUrl({ sku: "af_supreme_monthly", productType: "subscription", returnPath: "/upgrade" })

    expect(confirmSpy).toHaveBeenCalledWith(ASK.message)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).confirmSwitch).toBeUndefined()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ sku: "af_supreme_monthly", confirmSwitch: true })
    expect(result).toEqual({ ok: true, url: "/upgrade?checkout=success&switched=1", metaEvent: undefined })
  })

  it("🛑 saying no sends nothing more — the card is never charged", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(409, ASK))
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(window, "confirm").mockReturnValue(false)

    const result = await resolveCheckoutUrl({ sku: "af_supreme_monthly", productType: "subscription", returnPath: "/upgrade" })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: false, error: "No change made — you're still on your current plan." })
  })

  it("a declined card after confirming shows the server's sentence", async () => {
    const declined = "Your card was declined, so the switch to AF Supreme did not go through. Nothing changed."
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(json(409, ASK)).mockResolvedValueOnce(json(402, { error: declined, code: "payment_failed" })),
    )
    vi.spyOn(window, "confirm").mockReturnValue(true)

    const result = await resolveCheckoutUrl({ sku: "af_supreme_monthly", productType: "subscription", returnPath: "/upgrade" })

    expect(result).toEqual({ ok: false, error: declined })
  })
})
