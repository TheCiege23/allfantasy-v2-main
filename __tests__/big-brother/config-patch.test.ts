import { describe, expect, it } from 'vitest'
import { EDITABLE_BIG_BROTHER_FIELDS, parseBigBrotherConfigPatch } from '@/lib/big-brother/configPatch'
import { BB_DEADLINES, resolveBigBrotherDeadlines } from '@/lib/big-brother/schedule'

/** The one rule every Big Brother config write goes through (lib/big-brother/configPatch.ts). */

const open = { evictionsSoFar: 0, current: { juryStartMode: 'after_eliminations', juryStartAfterEliminations: 7, juryStartWhenRemaining: null, juryStartWeek: null } }
const late = { ...open, evictionsSoFar: 2 }

describe('parseBigBrotherConfigPatch', () => {
  it('accepts every live rule with a valid value, and passes only what was sent', () => {
    const r = parseBigBrotherConfigPatch(
      { nominationDeadlineDayOfWeek: 3, nominationDeadlineTimeUtc: '23:30', evictionTieBreakMode: 'commissioner', vetoCompetitorCount: 6, consecutiveHohAllowed: true },
      open,
    )
    expect(r).toEqual({
      ok: true,
      input: { nominationDeadlineDayOfWeek: 3, nominationDeadlineTimeUtc: '23:30', evictionTieBreakMode: 'commissioner', vetoCompetitorCount: 6, consecutiveHohAllowed: true },
      fields: ['nominationDeadlineDayOfWeek', 'nominationDeadlineTimeUtc', 'evictionTieBreakMode', 'vetoCompetitorCount', 'consecutiveHohAllowed'],
    })
  })

  it('a deadline can be cleared (null) to leave it unscheduled', () => {
    expect(parseBigBrotherConfigPatch({ vetoDrawDayOfWeek: null, vetoDrawTimeUtc: null }, open)).toMatchObject({ ok: true, input: { vetoDrawDayOfWeek: null, vetoDrawTimeUtc: null } })
  })

  it('refuses values the schedule would silently skip, naming the setting', () => {
    for (const [field, value] of [
      ['hohChallengeDayOfWeek', 0], ['hohChallengeDayOfWeek', 8], ['hohChallengeDayOfWeek', 2.5], ['hohChallengeDayOfWeek', '3'],
      ['evictionVoteCloseTimeUtc', '25:00'], ['evictionVoteCloseTimeUtc', '9:00'], ['evictionVoteCloseTimeUtc', 900],
    ] as const) {
      expect(parseBigBrotherConfigPatch({ [field]: value }, open)).toMatchObject({ ok: false, status: 400, field })
    }
  })

  it('every value it accepts is one the schedule actually places (no silent "unscheduled")', () => {
    const body = Object.fromEntries(BB_DEADLINES.flatMap((d) => [[`${d.prefix}DayOfWeek`, 7], [`${d.prefix}TimeUtc`, '23:59']]))
    const r = parseBigBrotherConfigPatch(body, open)
    expect(r.ok).toBe(true)
    const deadlines = resolveBigBrotherDeadlines((r as { input: Record<string, unknown> }).input as never, { createdAt: '2026-11-16T00:00:00Z' })
    expect(Object.values(deadlines).every((d) => d instanceof Date)).toBe(true)
  })

  it('refuses unknown choices, NaN-shaped numbers and non-booleans', () => {
    expect(parseBigBrotherConfigPatch({ evictionTieBreakMode: 'coin_flip' }, open)).toMatchObject({ ok: false, field: 'evictionTieBreakMode' })
    expect(parseBigBrotherConfigPatch({ challengeMode: 'HYBRID' }, open)).toMatchObject({ ok: false, field: 'challengeMode' })
    expect(parseBigBrotherConfigPatch({ vetoCompetitorCount: 'abc' }, open)).toMatchObject({ ok: false, field: 'vetoCompetitorCount' })
    expect(parseBigBrotherConfigPatch({ vetoCompetitorCount: 2 }, open)).toMatchObject({ ok: false, field: 'vetoCompetitorCount' })
    expect(parseBigBrotherConfigPatch({ vetoCompetitorCount: 13 }, open)).toMatchObject({ ok: false, field: 'vetoCompetitorCount' })
    expect(parseBigBrotherConfigPatch({ hohVotesOnlyInTie: 'yes' }, open)).toMatchObject({ ok: false, field: 'hohVotesOnlyInTie' })
  })

  it('refuses the four settings the game never reads, and anything else unknown', () => {
    for (const field of ['finalNomineeCount', 'antiCollusionLogging', 'inactivePlayerHandling', 'waiverReleaseTiming', 'premiumEngineSpec', 'leagueId']) {
      expect(EDITABLE_BIG_BROTHER_FIELDS).not.toContain(field)
      expect(parseBigBrotherConfigPatch({ [field]: 1 }, open)).toMatchObject({ ok: false, status: 400, field })
    }
  })

  it('refuses an empty or non-object request', () => {
    expect(parseBigBrotherConfigPatch({}, open)).toMatchObject({ ok: false, status: 400 })
    expect(parseBigBrotherConfigPatch(null, open)).toMatchObject({ ok: false, status: 400 })
    expect(parseBigBrotherConfigPatch([1], open)).toMatchObject({ ok: false, status: 400 })
  })

  it('jury and finale change before the first eviction only; other rules any time', () => {
    expect(parseBigBrotherConfigPatch({ finaleFormat: 'final_3' }, open)).toMatchObject({ ok: true })
    expect(parseBigBrotherConfigPatch({ finaleFormat: 'final_3' }, late)).toMatchObject({ ok: false, status: 409, field: 'finaleFormat' })
    expect(parseBigBrotherConfigPatch({ juryStartAfterEliminations: 5 }, late)).toMatchObject({ ok: false, status: 409 })
    expect(parseBigBrotherConfigPatch({ evictionTieBreakMode: 'random', challengeMode: 'hybrid' }, late)).toMatchObject({ ok: true })
  })

  it('a jury mode needs its number — from the request or already stored', () => {
    expect(parseBigBrotherConfigPatch({ juryStartMode: 'when_remaining' }, open)).toMatchObject({ ok: false, field: 'juryStartWhenRemaining' })
    expect(parseBigBrotherConfigPatch({ juryStartMode: 'when_remaining', juryStartWhenRemaining: 9 }, open)).toMatchObject({ ok: true })
    expect(parseBigBrotherConfigPatch({ juryStartMode: 'fixed_week', juryStartWeek: 0 }, open)).toMatchObject({ ok: false, field: 'juryStartWeek' })
    // The stored mode's number is already there.
    expect(parseBigBrotherConfigPatch({ juryStartMode: 'after_eliminations' }, open)).toMatchObject({ ok: true })
    // Clearing the number the current mode uses is refused.
    expect(parseBigBrotherConfigPatch({ juryStartAfterEliminations: null }, open)).toMatchObject({ ok: false, field: 'juryStartAfterEliminations' })
  })
})
