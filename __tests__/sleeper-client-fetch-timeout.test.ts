import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  getLeagueRosters,
  getLeagueTransactions,
  getLeagueDrafts,
  getDraftPicks,
} from "@/lib/sleeper-client"

/**
 * Regression cover for the `cron-decision-os-activity-ingest` hang (Aug 2026).
 *
 * Every call in `lib/sleeper-client.ts` was a bare `fetch()`. Node applies no total-request
 * deadline, so one stalled Sleeper connection held the Vercel function open until the platform
 * killed it at `maxDuration` — taking the job's telemetry row with it.
 *
 * Two properties are pinned here:
 *   1. every provider call carries an abort signal, so it can never hang indefinitely;
 *   2. `strict` callers can tell "Sleeper had no data" apart from "we could not reach Sleeper".
 */

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("every Sleeper read carries a timeout signal", () => {
  it.each([
    ["rosters", () => getLeagueRosters("L1")],
    ["transactions", () => getLeagueTransactions("L1", 3)],
    ["drafts", () => getLeagueDrafts("L1")],
    ["draft picks", () => getDraftPicks("D1")],
  ])("%s passes an AbortSignal", async (_label, call) => {
    const fetchMock = vi.fn(async () => jsonRes([]))
    global.fetch = fetchMock as unknown as typeof fetch

    await call()

    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe("default (non-strict) behaviour is unchanged", () => {
  it("still swallows a network failure and returns an empty list", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("socket hang up")
    }) as unknown as typeof fetch

    // ~30 existing callers rely on this forgiving contract; the timeout must not change it.
    await expect(getLeagueRosters("L1")).resolves.toEqual([])
    await expect(getLeagueTransactions("L1", 3)).resolves.toEqual([])
    await expect(getLeagueDrafts("L1")).resolves.toEqual([])
    await expect(getDraftPicks("D1")).resolves.toEqual([])
  })

  it("still returns an empty list on a 500", async () => {
    global.fetch = vi.fn(async () => jsonRes(null, 500)) as unknown as typeof fetch
    await expect(getLeagueRosters("L1")).resolves.toEqual([])
  })
})

describe("strict mode separates 'no data' from 'unreachable'", () => {
  it("throws when the request fails, so the caller can count the league as FAILED", async () => {
    global.fetch = vi.fn(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      })
    }) as unknown as typeof fetch

    // This is the whole point: a timed-out league must not look like a clean empty one.
    await expect(getLeagueRosters("L1", { strict: true })).rejects.toThrow(/sleeper_unavailable:rosters/)
    await expect(getLeagueTransactions("L1", 3, { strict: true })).rejects.toThrow(
      /sleeper_unavailable:transactions_week_3/,
    )
    await expect(getLeagueDrafts("L1", { strict: true })).rejects.toThrow(/sleeper_unavailable:drafts/)
    await expect(getDraftPicks("D1", { strict: true })).rejects.toThrow(/sleeper_unavailable:draft_picks/)
  })

  it("throws on a 5xx", async () => {
    global.fetch = vi.fn(async () => jsonRes(null, 500)) as unknown as typeof fetch
    await expect(getLeagueRosters("L1", { strict: true })).rejects.toThrow(/HTTP 500/)
  })

  it("throws on a 429 — a throttled caller has NOT read the league", async () => {
    global.fetch = vi.fn(async () => jsonRes(null, 429)) as unknown as typeof fetch
    await expect(getLeagueTransactions("L1", 5, { strict: true })).rejects.toThrow(/HTTP 429/)
  })

  it("treats a 404 as legitimate no-data, not a failure", async () => {
    // A week beyond the season 404s. That is real information, not an outage.
    global.fetch = vi.fn(async () => jsonRes(null, 404)) as unknown as typeof fetch
    await expect(getLeagueTransactions("L1", 18, { strict: true })).resolves.toEqual([])
    await expect(getLeagueDrafts("L1", { strict: true })).resolves.toEqual([])
  })

  it("returns data normally on success", async () => {
    global.fetch = vi.fn(async () => jsonRes([{ roster_id: 1 }])) as unknown as typeof fetch
    await expect(getLeagueRosters("L1", { strict: true })).resolves.toEqual([{ roster_id: 1 }])
  })
})
