/**
 * `/api/cron/compute-projections` — "the season has not been played" vs "the engine is broken".
 *
 * WHY THIS EXISTS. This job projects targetSeason from sourceSeason. Before a season starts every
 * player refuses with `no_games_played`, there is nothing to project from, and the route returned
 * HTTP 500 every single day of the offseason. Observed live: 47 stat lines read, 47 refused, all
 * `no_games_played`, refusalRate 1.0 against a 0.4 threshold.
 *
 * A daily red for a condition the calendar fixes in September is a red nobody reads by the time it
 * means something.
 *
 * THE RISK IS THAT THE CARVE-OUT SWALLOWS REAL FAILURES. The threshold it sits next to exists to
 * catch "an upstream input vanished" — so most of these tests assert the cases that must STILL
 * fail. The permissive case is one line; the guards around it are the point.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { writeMock } = vi.hoisted(() => ({ writeMock: vi.fn() }))

vi.mock('@/lib/af-projections/writeAfProjectionSnapshots', () => ({
  writeAfProjectionSnapshots: writeMock,
}))

import { GET } from '@/app/api/cron/compute-projections/route'

const SECRET = 'test-cron-secret'
const ORIGINAL_ENV = { ...process.env }

function req(path = '/api/cron/compute-projections'): never {
  return new Request(`http://localhost${path}`, {
    headers: { authorization: `Bearer ${SECRET}` },
  }) as never
}

/** Shape of writeAfProjectionSnapshots' report, with only the fields the route reads. */
function report(over: Record<string, unknown> = {}) {
  return {
    sourceSeason: 2026,
    targetSeason: 2027,
    scoringFormat: 'ppr',
    idpPreset: 'balanced',
    statLinesRead: 0,
    written: 0,
    refused: 0,
    refusalsByReason: {},
    basisCounts: {},
    confidenceCounts: {},
    usedTackleSplitEstimate: 0,
    withoutWeeklyData: 0,
    errors: [] as string[],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  process.env.NODE_ENV = 'test'
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('the source season not being played is a calendar fact, not a failure', () => {
  it('returns HTTP 200 with ok:false when every refusal is no_games_played', async () => {
    // The exact production payload that was 500ing daily.
    writeMock.mockResolvedValue(
      report({ statLinesRead: 47, written: 0, refused: 47, refusalsByReason: { no_games_played: 47 } }),
    )

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.failureReason).toBe('source_season_not_played_yet')
    expect(body.written).toBe(0)
  })

  it('still reports the reason in the body, so the gap leaves a trace', async () => {
    writeMock.mockResolvedValue(
      report({ statLinesRead: 5, written: 0, refused: 5, refusalsByReason: { no_games_played: 5 } }),
    )
    const body = await (await GET(req())).json()
    // ok:false + a named reason is what stops HTTP 200 reading as "all good".
    expect(body).toMatchObject({ ok: false, failureReason: 'source_season_not_played_yet' })
  })
})

describe('the carve-out does not swallow real failures', () => {
  it('MIXED refusal reasons with zero rows still 500 — some players DID have games', async () => {
    writeMock.mockResolvedValue(
      report({
        statLinesRead: 47,
        written: 0,
        refused: 47,
        refusalsByReason: { no_games_played: 20, insufficient_sample: 27 },
      }),
    )

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.failureReason).toBe('zero_rows_written')
  })

  it('a different single reason with zero rows still 500s', async () => {
    // insufficient_sample everywhere means data EXISTED and the engine rejected it.
    writeMock.mockResolvedValue(
      report({ statLinesRead: 47, written: 0, refused: 47, refusalsByReason: { insufficient_sample: 47 } }),
    )
    expect((await GET(req())).status).toBe(500)
  })

  it('a refusal rate above the threshold still 500s when rows were written', async () => {
    // The case REFUSAL_RATE_FAILURE_THRESHOLD was written for: an upstream input vanished.
    writeMock.mockResolvedValue(
      report({ statLinesRead: 100, written: 40, refused: 60, refusalsByReason: { insufficient_sample: 60 } }),
    )

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.failureReason).toBe('refusal_rate_above_threshold')
  })

  it('zero rows AND zero refusals is still a failure, not a quiet pass', async () => {
    // Nothing considered at all — the carve-out requires refused > 0 precisely so this cannot
    // slip through as "the season has not started".
    writeMock.mockResolvedValue(report({ statLinesRead: 0, written: 0, refused: 0, refusalsByReason: {} }))

    const res = await GET(req())
    expect(res.status).toBe(500)
    expect((await res.json()).failureReason).toBe('zero_rows_written')
  })
})

describe('a healthy in-season run is unaffected', () => {
  it('passes with the measured ~15% baseline refusal rate', async () => {
    // 251 insufficient_sample + 39 no_scoring_basis of 1,933 — the baseline the threshold comment
    // documents. This must stay green or the threshold is mistuned.
    writeMock.mockResolvedValue(
      report({
        statLinesRead: 1933,
        written: 1643,
        refused: 290,
        refusalsByReason: { insufficient_sample: 251, no_scoring_basis: 39 },
      }),
    )

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.failureReason).toBeUndefined()
  })
})
