import { describe, expect, it } from "vitest"
import {
  bucketKeyFor,
  bucketize,
  bucketizeDistinct,
  buildBucketKeys,
  civilDateIn,
  distinctWithin,
  markCurrentBucket,
  REPORTING_TZ,
} from "@/lib/admin-dashboard/AdminGrowthSeriesService"

/**
 * Bucketing is pure and tested with no database — which is the point. The only
 * database this checkout can reach is production (see CLAUDE.md), so the logic
 * that decides which day a signup lands on has to be verifiable without one.
 *
 * ⚠ THE TIMEZONE CASES ARE THE REASON THIS FILE EXISTS. Every one of them
 * passes trivially if you bucket in UTC, and every one of them is wrong for a
 * US operator. They are written as instants that fall on a DIFFERENT calendar
 * day in UTC than in America/New_York, so a regression to UTC bucketing turns
 * them red instead of quietly moving five hours of every evening into tomorrow.
 */

describe("civilDateIn", () => {
  it("reads the wall-clock date in the reporting timezone, not UTC", () => {
    // 01:30 UTC on Sep 2 is still 21:30 on Sep 1 in New York.
    expect(civilDateIn(new Date("2026-09-02T01:30:00Z"), REPORTING_TZ)).toEqual({ y: 2026, m: 9, d: 1 })
    expect(civilDateIn(new Date("2026-09-02T01:30:00Z"), "UTC")).toEqual({ y: 2026, m: 9, d: 2 })
  })
})

describe("bucketKeyFor", () => {
  it("buckets an evening ET timestamp into that evening, not the next UTC day", () => {
    const lateEvening = new Date("2026-09-02T03:00:00Z") // 23:00 ET on Sep 1
    expect(bucketKeyFor(lateEvening, "day")).toBe("2026-09-01")
    expect(bucketKeyFor(lateEvening, "month")).toBe("2026-09")
  })

  it("starts week buckets on Monday", () => {
    // 2026-09-01 is a Tuesday; its week starts Monday 2026-08-31.
    expect(bucketKeyFor(new Date("2026-09-01T16:00:00Z"), "week")).toBe("2026-08-31")
    // A Sunday belongs to the week that began the previous Monday, not the next.
    expect(bucketKeyFor(new Date("2026-09-06T16:00:00Z"), "week")).toBe("2026-08-31")
    // The following Monday opens a new bucket.
    expect(bucketKeyFor(new Date("2026-09-07T16:00:00Z"), "week")).toBe("2026-09-07")
  })

  it("survives both DST transitions", () => {
    // US DST 2026: starts Mar 8, ends Nov 1. Offset changes across these pairs,
    // so any implementation doing fixed offset arithmetic drifts by an hour.
    expect(bucketKeyFor(new Date("2026-03-07T18:00:00Z"), "day")).toBe("2026-03-07") // EST, -5
    expect(bucketKeyFor(new Date("2026-03-09T18:00:00Z"), "day")).toBe("2026-03-09") // EDT, -4
    expect(bucketKeyFor(new Date("2026-10-31T18:00:00Z"), "day")).toBe("2026-10-31") // EDT
    expect(bucketKeyFor(new Date("2026-11-02T18:00:00Z"), "day")).toBe("2026-11-02") // EST
  })

  it("keeps a DST-transition Sunday in the week that began before the shift", () => {
    // Nov 1 2026 is the Sunday the clocks go back; its week began Mon Oct 26.
    expect(bucketKeyFor(new Date("2026-11-01T16:00:00Z"), "week")).toBe("2026-10-26")
  })
})

describe("buildBucketKeys", () => {
  const now = new Date("2026-09-01T16:00:00Z")

  it("returns the right count per granularity, oldest first, ending at today", () => {
    const days = buildBucketKeys("day", now)
    expect(days).toHaveLength(30)
    expect(days[29]).toBe("2026-09-01")
    expect(days[28]).toBe("2026-08-31")
    expect([...days].sort()).toEqual(days) // already chronological

    const weeks = buildBucketKeys("week", now)
    expect(weeks).toHaveLength(12)
    expect(weeks[11]).toBe("2026-08-31") // the Monday of this week
    expect(weeks[10]).toBe("2026-08-24")

    const months = buildBucketKeys("month", now)
    expect(months).toHaveLength(12)
    expect(months[11]).toBe("2026-09")
    expect(months[0]).toBe("2025-10")
  })

  it("produces gap-free keys so a quiet period renders as zero, not as a missing column", () => {
    const days = buildBucketKeys("day", now)
    const unique = new Set(days)
    expect(unique.size).toBe(days.length)
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(`${days[i - 1]}T00:00:00Z`).getTime()
      const cur = new Date(`${days[i]}T00:00:00Z`).getTime()
      expect(cur - prev).toBe(86_400_000)
    }
  })

  it("crosses a month boundary without repeating or skipping a day", () => {
    const days = buildBucketKeys("day", new Date("2026-03-02T16:00:00Z"))
    expect(days).toHaveLength(30)
    expect(days[29]).toBe("2026-03-02")
    expect(days[28]).toBe("2026-03-01")
    expect(days[27]).toBe("2026-02-28")
  })
})

describe("bucketize", () => {
  const now = new Date("2026-09-01T16:00:00Z")
  const keys = buildBucketKeys("day", now)

  it("counts into the right buckets and zero-fills the rest", () => {
    const out = bucketize(
      [
        new Date("2026-09-01T14:00:00Z"),
        new Date("2026-09-01T15:00:00Z"),
        new Date("2026-08-31T14:00:00Z"),
      ],
      "day",
      keys,
    )
    expect(out).toHaveLength(30)
    expect(out.find((b) => b.key === "2026-09-01")?.value).toBe(2)
    expect(out.find((b) => b.key === "2026-08-31")?.value).toBe(1)
    expect(out.filter((b) => b.value === 0)).toHaveLength(28)
  })

  it("drops timestamps outside the window rather than folding them into an edge bucket", () => {
    const out = bucketize([new Date("2020-01-01T00:00:00Z")], "day", keys)
    expect(out.reduce((s, b) => s + b.value, 0)).toBe(0)
  })

  it("gives every bucket a human label", () => {
    const out = bucketize([], "day", keys)
    expect(out.every((b) => b.label.length > 0)).toBe(true)
    expect(out[29].label).toBe("Sep 1")
  })
})

describe("bucketizeDistinct", () => {
  const now = new Date("2026-09-01T16:00:00Z")
  const keys = buildBucketKeys("day", now)

  it("counts a repeat visitor once per bucket", () => {
    const rows = [
      { createdAt: new Date("2026-09-01T10:00:00Z"), userId: "u1" },
      { createdAt: new Date("2026-09-01T11:00:00Z"), userId: "u1" },
      { createdAt: new Date("2026-09-01T12:00:00Z"), userId: "u1" },
      { createdAt: new Date("2026-09-01T13:00:00Z"), userId: "u2" },
    ]
    expect(bucketizeDistinct(rows, "day", keys).find((b) => b.key === "2026-09-01")?.value).toBe(2)
  })

  it("counts the same user again in a different bucket", () => {
    const rows = [
      { createdAt: new Date("2026-09-01T10:00:00Z"), userId: "u1" },
      { createdAt: new Date("2026-08-31T10:00:00Z"), userId: "u1" },
    ]
    const out = bucketizeDistinct(rows, "day", keys)
    expect(out.find((b) => b.key === "2026-09-01")?.value).toBe(1)
    expect(out.find((b) => b.key === "2026-08-31")?.value).toBe(1)
  })

  it("ignores anonymous rows instead of counting them as one shared user", () => {
    const rows = [
      { createdAt: new Date("2026-09-01T10:00:00Z"), userId: null },
      { createdAt: new Date("2026-09-01T11:00:00Z"), userId: null },
      { createdAt: new Date("2026-09-01T12:00:00Z"), userId: "u1" },
    ]
    expect(bucketizeDistinct(rows, "day", keys).find((b) => b.key === "2026-09-01")?.value).toBe(1)
  })
})

describe("distinctWithin", () => {
  const now = new Date("2026-09-01T16:00:00Z")

  it("counts a user active in many buckets exactly once", () => {
    const keys = buildBucketKeys("month", now)
    // One person, active in every one of the twelve months.
    const rows = keys.map((k) => ({ createdAt: new Date(`${k}-15T16:00:00Z`), userId: "u1" }))

    const buckets = bucketizeDistinct(rows, "month", keys)
    const summed = buckets.reduce((s, b) => s + b.value, 0)

    // 🛑 THE WHOLE POINT: summing per-bucket distinct counts inflates by 12x.
    expect(summed).toBe(12)
    expect(distinctWithin(rows, "month", keys)).toBe(1)
  })

  it("counts distinct people, not events", () => {
    const keys = buildBucketKeys("day", now)
    const rows = [
      { createdAt: new Date("2026-09-01T10:00:00Z"), userId: "u1" },
      { createdAt: new Date("2026-09-01T11:00:00Z"), userId: "u1" },
      { createdAt: new Date("2026-08-30T11:00:00Z"), userId: "u2" },
      { createdAt: new Date("2026-08-29T11:00:00Z"), userId: "u3" },
    ]
    expect(distinctWithin(rows, "day", keys)).toBe(3)
  })

  it("ignores rows outside the drawn window so the total matches the chart", () => {
    const keys = buildBucketKeys("day", now)
    const rows = [
      { createdAt: new Date("2026-09-01T10:00:00Z"), userId: "u1" },
      { createdAt: new Date("2020-01-01T10:00:00Z"), userId: "u-ancient" },
    ]
    expect(distinctWithin(rows, "day", keys)).toBe(1)
  })

  it("ignores anonymous rows", () => {
    const keys = buildBucketKeys("day", now)
    const rows = [
      { createdAt: new Date("2026-09-01T10:00:00Z"), userId: null },
      { createdAt: new Date("2026-09-01T10:00:00Z"), userId: "u1" },
    ]
    expect(distinctWithin(rows, "day", keys)).toBe(1)
  })
})

describe("markCurrentBucket", () => {
  const now = new Date("2026-09-01T16:00:00Z") // Tue 1 Sep, 12:00 ET

  it("marks the in-progress period and nothing else", () => {
    for (const g of ["day", "week", "month"] as const) {
      const keys = buildBucketKeys(g, now)
      const marked = markCurrentBucket(bucketize([], g, keys), g, now)
      const partials = marked.filter((b) => b.partial)
      expect(partials, `granularity ${g}`).toHaveLength(1)
      // buildBucketKeys ends at the current period, so it is the last column.
      expect(marked[marked.length - 1].partial, `granularity ${g}`).toBe(true)
    }
  })

  it("marks the period containing `now` in the REPORTING timezone, not UTC", () => {
    // 02:00 UTC on Sep 2 is 22:00 ET on Sep 1 — still Sep 1's bucket.
    const lateEvening = new Date("2026-09-02T02:00:00Z")
    const keys = buildBucketKeys("day", lateEvening)
    const marked = markCurrentBucket(bucketize([], "day", keys), "day", lateEvening)
    expect(marked.find((b) => b.partial)?.key).toBe("2026-09-01")
  })

  it("leaves values untouched — marking is presentation, not filtering", () => {
    const keys = buildBucketKeys("day", now)
    const buckets = bucketize(
      [new Date("2026-09-01T14:00:00Z"), new Date("2026-08-31T14:00:00Z")],
      "day",
      keys,
    )
    const before = buckets.map((b) => b.value)
    const marked = markCurrentBucket(buckets, "day", now)
    expect(marked.map((b) => b.value)).toEqual(before)
    // The partial column still carries its real count; it is short, not empty.
    expect(marked.find((b) => b.key === "2026-09-01")?.value).toBe(1)
  })

  it("does not mutate the input array", () => {
    const keys = buildBucketKeys("day", now)
    const buckets = bucketize([], "day", keys)
    markCurrentBucket(buckets, "day", now)
    expect(buckets.every((b) => b.partial === undefined)).toBe(true)
  })
})
