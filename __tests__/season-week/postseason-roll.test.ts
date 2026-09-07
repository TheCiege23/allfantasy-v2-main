/**
 * The postseason roller.
 *
 * 🛑 EVERY STEP IT DRIVES ALREADY EXISTED AND HAD NEVER RUN. Generate, advance
 * and finalize each have a real engine and a real commissioner button, and
 * production holds **zero playoff brackets, zero championships and zero season
 * archives** — because no league ever reached the regular-season boundary that
 * starts the sequence.
 *
 * What matters here is not that it advances. It is that it REFUSES correctly:
 * a tie must reach a human, an incomplete round must wait, and the three
 * runtime functions it calls have three DIFFERENT contracts (one throws, two
 * return result unions) which is exactly how a caller ends up handling one and
 * silently swallowing another.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const findManySeasons = vi.fn()
const generateBracket = vi.fn()
const advanceRound = vi.fn()
const finalizeSeason = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { redraftSeason: { findMany: (...a: unknown[]) => findManySeasons(...a) } },
}))
vi.mock('@/lib/playoff-runtime', () => ({
  generateNflRedraftPlayoffRuntimeBracket: (...a: unknown[]) => generateBracket(...a),
  advanceNflRedraftPlayoffRuntimeRound: (...a: unknown[]) => advanceRound(...a),
}))
vi.mock('@/lib/redraft/offseason/finalizeSeasonAndEnterOffseason', () => ({
  finalizeSeasonAndEnterOffseason: (...a: unknown[]) => finalizeSeason(...a),
}))
vi.mock('@/lib/schedule-runtime', () => ({ advanceNflRedraftScheduleWeek: vi.fn() }))
vi.mock('@/lib/season-week/seasonWeekService', () => ({
  resolveSeasonWeekForRedraftSeason: vi.fn(),
}))

import { rollPostseason } from '@/lib/season-week/rollSeasonWeek'

const SEASON = { id: 's1', leagueId: 'l1', status: 'playoffs' }

beforeEach(() => {
  vi.clearAllMocks()
  findManySeasons.mockResolvedValue([SEASON])
})

describe('rollPostseason', () => {
  it('scopes to postseason statuses only', async () => {
    await rollPostseason()
    const where = findManySeasons.mock.calls[0][0].where
    expect(where.status).toEqual({ in: ['regular_season_complete', 'playoffs'] })
    // Native leagues only, same as every other engine.
    expect(where.league).toBeDefined()
  })

  it('generates a bracket for a season that reached the boundary without one', async () => {
    findManySeasons.mockResolvedValue([{ ...SEASON, status: 'regular_season_complete' }])
    generateBracket.mockResolvedValue({ state: {}, bracket: {}, rounds: [], events: [] })

    const out = await rollPostseason()
    expect(out.generated).toBe(1)
    expect(out.outcomes[0].step).toBe('generated_bracket')
    expect(advanceRound).not.toHaveBeenCalled()
  })

  it('treats a THROWN generator failure as a hold, not a crash', async () => {
    // 🛑 THE CONTRACT MISMATCH THIS PINS. `generateNflRedraftPlayoffRuntimeBracket`
    // throws; the two functions beside it return `{ ok, code }`. The first version
    // of this roller read `bracket.ok` on a value with no `ok` — always falsy —
    // so every successful generation would have been recorded as a hold.
    findManySeasons.mockResolvedValue([{ ...SEASON, status: 'regular_season_complete' }])
    generateBracket.mockRejectedValue(new Error('not_enough_teams'))

    const out = await rollPostseason()
    expect(out.generated).toBe(0)
    expect(out.held).toBe(1)
    expect(out.outcomes[0]).toMatchObject({ step: 'held', detail: 'not_enough_teams' })
  })

  it('advances a round when the runtime allows it', async () => {
    advanceRound.mockResolvedValue({ ok: true, events: [] })
    const out = await rollPostseason()
    expect(out.advanced).toBe(1)
    expect(out.outcomes[0].step).toBe('advanced_round')
    expect(finalizeSeason).not.toHaveBeenCalled()
  })

  it('never resolves a tie itself', async () => {
    // 🛑 A SCHEDULED JOB MUST NOT PICK A WINNER. The runtime refuses with
    // TIE_UNRESOLVED and that refusal has to survive automation intact.
    advanceRound.mockResolvedValue({ ok: false, code: 'TIE_UNRESOLVED', message: 'tied' })
    const out = await rollPostseason()
    expect(out.advanced).toBe(0)
    expect(out.finalized).toBe(0)
    expect(out.outcomes[0]).toMatchObject({ step: 'held', detail: 'TIE_UNRESOLVED' })
  })

  it('waits on an incomplete round instead of overriding it', async () => {
    advanceRound.mockResolvedValue({ ok: false, code: 'MATCHUPS_INCOMPLETE', message: 'x' })
    const out = await rollPostseason()
    expect(out.held).toBe(1)
    expect(finalizeSeason).not.toHaveBeenCalled()
  })

  it('finalizes when there is no round left to advance', async () => {
    // NO_ACTIVE_ROUND is the season ENDING, not a failure — the one refusal
    // code that must be read as "done" rather than "wait".
    advanceRound.mockResolvedValue({ ok: false, code: 'NO_ACTIVE_ROUND', message: 'x' })
    finalizeSeason.mockResolvedValue({
      ok: true,
      alreadyFinalized: false,
      championRosterId: 'r9',
      offseasonEntered: true,
    })

    const out = await rollPostseason()
    expect(out.finalized).toBe(1)
    expect(out.outcomes[0]).toMatchObject({
      step: 'finalized',
      championRosterId: 'r9',
      offseasonEntered: true,
    })
    // The whole chain, via the extracted service — champion, archive, offseason.
    expect(finalizeSeason).toHaveBeenCalledWith(
      expect.objectContaining({ seasonId: 's1', leagueId: 'l1' }),
    )
  })

  it('holds when finalize itself refuses', async () => {
    advanceRound.mockResolvedValue({ ok: false, code: 'NO_ACTIVE_ROUND', message: 'x' })
    finalizeSeason.mockResolvedValue({ ok: false, code: 'NO_BRACKET', message: 'x', result: {} })
    const out = await rollPostseason()
    expect(out.finalized).toBe(0)
    expect(out.outcomes[0]).toMatchObject({ step: 'held', detail: 'NO_BRACKET' })
  })

  it('writes nothing on a dry run', async () => {
    const out = await rollPostseason({ dryRun: true })
    expect(out.held).toBe(1)
    expect(generateBracket).not.toHaveBeenCalled()
    expect(advanceRound).not.toHaveBeenCalled()
    expect(finalizeSeason).not.toHaveBeenCalled()
  })

  it('takes ONE step per season per run', async () => {
    // A loop that drained every available round in one pass would collapse a
    // three-week postseason into a single tick.
    advanceRound.mockResolvedValue({ ok: true, events: [] })
    await rollPostseason()
    expect(advanceRound).toHaveBeenCalledTimes(1)
  })
})
