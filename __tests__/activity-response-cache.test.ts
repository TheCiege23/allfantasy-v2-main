// @vitest-environment node
/**
 * lib/activity/activity-response-cache.ts — the coalescing half of the League Buzz self-defense.
 * Deterministic via the explicit `now` param (no fake timers): proves key distinctness, sliding
 * TTL, expiry, defensive copies, and that a genuinely-empty feed is a real cacheable value.
 */
import { afterEach, describe, expect, it } from "vitest"
import type { ActivityFeedItem } from "@/lib/activity/types"
import {
  ACTIVITY_CACHE_TTL_MS,
  buildActivityCacheKey,
  clearActivityFeedCache,
  getActivityFeedCacheSize,
  getCachedActivityFeed,
  setCachedActivityFeed,
} from "@/lib/activity/activity-response-cache"

const item = (id: string): ActivityFeedItem => ({
  id,
  type: "trade",
  userId: "",
  userName: "League",
  description: "x",
  timestamp: "2026-07-17T00:00:00.000Z",
  leagueId: "L1",
  leagueName: "L1",
})

afterEach(() => clearActivityFeedCache())

describe("buildActivityCacheKey", () => {
  it("distinguishes on userId, leagueId, and limit — a response is only served for its exact params", () => {
    const keys = new Set([
      buildActivityCacheKey("userA", "L1", 20),
      buildActivityCacheKey("userB", "L1", 20),
      buildActivityCacheKey("userA", "L2", 20),
      buildActivityCacheKey("userA", "L1", 50),
    ])
    expect(keys.size).toBe(4)
  })

  it("folds an undefined leagueId to a stable token so the key is always total", () => {
    expect(buildActivityCacheKey("userA", undefined, 20)).toBe(buildActivityCacheKey("userA", undefined, 20))
    expect(buildActivityCacheKey("userA", undefined, 20)).not.toBe(buildActivityCacheKey("userA", "L1", 20))
  })
})

describe("get/set", () => {
  it("returns a cached feed within the TTL and null after it expires", () => {
    const key = buildActivityCacheKey("userA", "L1", 20)

    // Fresh within the window (no intervening read, so the sliding TTL doesn't confound the check).
    setCachedActivityFeed(key, [item("a")], 1_000)
    expect(getCachedActivityFeed(key, 1_000 + ACTIVITY_CACHE_TTL_MS - 1)?.map((i) => i.id)).toEqual(["a"])

    // At/after expiry it's a miss and the stale entry is dropped.
    setCachedActivityFeed(key, [item("a")], 1_000)
    expect(getCachedActivityFeed(key, 1_000 + ACTIVITY_CACHE_TTL_MS)).toBeNull()
    expect(getActivityFeedCacheSize()).toBe(0)
  })

  it("caches a genuinely-empty successful feed as a real value (honest-empty is cacheable)", () => {
    const key = buildActivityCacheKey("userA", "L1", 20)
    setCachedActivityFeed(key, [], 1_000)
    expect(getCachedActivityFeed(key, 1_500)).toEqual([])
  })

  it("slides the TTL on a hit — a steadily-polled key stays warm", () => {
    const key = buildActivityCacheKey("userA", "L1", 20)
    setCachedActivityFeed(key, [item("a")], 0)
    // A hit near the end of the window refreshes expiry, so a later read still within one TTL of
    // the *hit* (but well past the original expiry) is still fresh.
    expect(getCachedActivityFeed(key, ACTIVITY_CACHE_TTL_MS - 1)).not.toBeNull()
    expect(getCachedActivityFeed(key, 2 * ACTIVITY_CACHE_TTL_MS - 2)).not.toBeNull()
  })

  it("returns a defensive copy — mutating the result can't corrupt the stored feed", () => {
    const key = buildActivityCacheKey("userA", "L1", 20)
    setCachedActivityFeed(key, [item("a")], 1_000)
    const first = getCachedActivityFeed(key, 1_100)!
    first.push(item("injected"))
    expect(getCachedActivityFeed(key, 1_200)?.map((i) => i.id)).toEqual(["a"])
  })
})
