import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/prisma", () => ({ prisma: { playerIdentityMap: { findMany: vi.fn() } } }))
vi.mock("@/lib/get-base-url", () => ({ getBaseUrl: () => "https://allfantasy.ai" }))

import { apnsBody } from "@/lib/push-notifications/apns"
import { absolutePushImageUrl } from "@/lib/push-notifications/push-service"
import { injuryAlert } from "@/lib/notification-engine"
import { headshotsByRiId } from "@/lib/live/bigPlayNotifier"
import { prisma } from "@/lib/prisma"

describe("APNs body carries a picture only when there is one", () => {
  it("sets mutable-content and imageUrl for an https picture", () => {
    const body = JSON.parse(apnsBody({ title: "TD", imageUrl: "https://sleepercdn.com/x.jpg" }))
    expect(body.aps["mutable-content"]).toBe(1)
    expect(body.imageUrl).toBe("https://sleepercdn.com/x.jpg")
  })

  it("leaves both out with no picture, so the alert is unchanged for every existing sender", () => {
    const body = JSON.parse(apnsBody({ title: "TD" }))
    expect(body.aps).not.toHaveProperty("mutable-content")
    expect(body).not.toHaveProperty("imageUrl")
  })

  it("drops a non-https picture rather than handing the extension something iOS will refuse", () => {
    const body = JSON.parse(apnsBody({ title: "TD", imageUrl: "http://example.com/x.jpg" }))
    expect(body.aps).not.toHaveProperty("mutable-content")
    expect(body).not.toHaveProperty("imageUrl")
  })
})

describe("absolutePushImageUrl", () => {
  it.each([
    ["https://cdn.example.com/a.png", "https://cdn.example.com/a.png"],
    ["/api/push-card/trade/1.png", "https://allfantasy.ai/api/push-card/trade/1.png"],
    ["http://cdn.example.com/a.png", null],
    ["//evil.example.com/a.png", null],
    ["javascript:alert(1)", null],
    ["data:image/png;base64,AAAA", null],
    ["", null],
    [null, null],
  ])("%s -> %s", (input, expected) => {
    expect(absolutePushImageUrl(input as string | null)).toBe(expected)
  })
})

describe("injuryAlert", () => {
  it("says what the report says, and carries the headshot", () => {
    const e = injuryAlert({
      playerName: "Breece Hall",
      team: "NYJ",
      status: "Out",
      bodyPart: "Knee",
      notes: "Did not practice Wednesday or Thursday.",
      imageUrl: "https://sleepercdn.com/content/nfl/players/thumb/8155.jpg",
    })
    expect(e.body).toBe("Breece Hall has been listed as Out (Knee). Did not practice Wednesday or Thursday.")
    expect(e.meta?.imageUrl).toBe("https://sleepercdn.com/content/nfl/players/thumb/8155.jpg")
  })

  it("keeps the old sentence when the report has no detail", () => {
    const e = injuryAlert({ playerName: "A B", team: "KC", status: "IR" })
    expect(e.body).toBe("A B has been listed as IR.")
    expect(e.meta).not.toHaveProperty("imageUrl")
  })
})

describe("headshotsByRiId", () => {
  beforeEach(() => vi.mocked(prisma.playerIdentityMap.findMany).mockReset())

  it("maps a Rolling Insights id to its Sleeper headshot, and skips a player with no identity", async () => {
    vi.mocked(prisma.playerIdentityMap.findMany).mockResolvedValue([
      { rollingInsightsId: "ri-1", sleeperId: "8155" },
    ] as never)
    const map = await headshotsByRiId(["ri-1", "ri-2"])
    expect(map.get("ri-1")).toBe("https://sleepercdn.com/content/nfl/players/thumb/8155.jpg")
    expect(map.has("ri-2")).toBe(false)
  })
})
