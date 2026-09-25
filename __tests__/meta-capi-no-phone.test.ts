import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/analytics/recordAnalyticsEvent", () => ({ recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined) }))

import { sendMetaCAPIEvent } from "@/lib/meta-capi"

/**
 * /privacy#sms-communications and /terms#sms-terms promise mobile numbers are never
 * shared with third parties for marketing, and the A2P 10DLC campaign is registered on
 * that text. The signup route passes the user's phone to the Meta Conversions API, so
 * the exit itself must drop it.
 */
function payloadSentToMeta(fetchMock: ReturnType<typeof vi.fn>) {
  expect(fetchMock).toHaveBeenCalledTimes(1)
  return JSON.parse(fetchMock.mock.calls[0][1].body)
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("sendMetaCAPIEvent never sends a phone number", () => {
  it("drops the phone even when the caller passes one, and keeps email matching", async () => {
    vi.stubEnv("META_CONVERSIONS_API_TOKEN", "test-token")
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events_received: 1 }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    await sendMetaCAPIEvent({
      eventName: "CompleteRegistration",
      eventId: "evt-1",
      email: "Someone@Example.com",
      phone: "+1 (555) 123-4567",
      userId: "user-1",
    })

    const body = payloadSentToMeta(fetchMock)
    const userData = body.data[0].user_data
    expect(userData.ph).toBeUndefined()
    expect(JSON.stringify(body)).not.toMatch(/5551234567|555\) 123/)
    expect(userData.em).toHaveLength(1)
    expect(userData.external_id).toHaveLength(1)
  })
})
