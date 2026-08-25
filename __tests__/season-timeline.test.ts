import { describe, expect, it } from 'vitest'

import { buildSeasonTimeline, regularSeasonWeeks } from '@/lib/core-app/seasonTimeline'

/**
 * The timeline is a claim about a league's rules. Every phase in it has to come
 * from that league's own settings, because someone plans against it.
 */

const keys = (t: ReturnType<typeof buildSeasonTimeline>) => t.phases.map((p) => p.key)
const find = (t: ReturnType<typeof buildSeasonTimeline>, k: string) =>
  t.phases.find((p) => p.key === k)

describe('buildSeasonTimeline', () => {
  it('reads the trade deadline from the league, not from a default', () => {
    const t = buildSeasonTimeline({
      settings: { playoff_start_week: 15, trade_deadline_week: 11, playoff_teams: 6 },
      currentWeek: 3,
    })
    expect(find(t, 'trade-deadline')!.when).toBe('WK 11')
  })

  it('⚠ shows NO trade deadline when the league has none', () => {
    /*
     * THE LIE THIS PREVENTS. The panel printed "Trade deadline WK 10" for every
     * league — the default of a typical Sleeper redraft. A league that trades
     * all season would have had its managers planning around a deadline that
     * does not exist.
     */
    const t = buildSeasonTimeline({
      settings: { playoff_start_week: 15, playoff_teams: 6 },
      currentWeek: 3,
    })
    expect(keys(t)).not.toContain('trade-deadline')
    expect(t.notes.join(' ')).toContain('trades stay open all season')
  })

  it('treats Sleeper&apos;s 0 as "no deadline", not as week zero', () => {
    const t = buildSeasonTimeline({
      settings: { playoff_start_week: 15, trade_deadline_week: 0 },
      currentWeek: 3,
    })
    expect(keys(t)).not.toContain('trade-deadline')
  })

  it('splits the regular season around the deadline, which is what people plan against', () => {
    const t = buildSeasonTimeline({
      settings: { playoff_start_week: 15, trade_deadline_week: 11, playoff_teams: 6 },
      currentWeek: 3,
    })
    expect(find(t, 'regular-early')!.when).toBe('WK 1-11')
    expect(find(t, 'regular-late')!.when).toBe('WK 12-14')
  })

  it('derives the regular season end from the playoff start, never a fixed 14', () => {
    const t = buildSeasonTimeline({
      settings: { playoff_start_week: 14, trade_deadline_week: 10, playoff_teams: 4 },
      currentWeek: 1,
    })
    expect(find(t, 'regular-late')!.when).toBe('WK 11-13')
  })

  it('sizes the playoffs from the number of playoff teams', () => {
    // 6 teams => 3 rounds => weeks 15,16,17 with 17 the final.
    const t = buildSeasonTimeline({
      settings: { playoff_start_week: 15, trade_deadline_week: 11, playoff_teams: 6 },
      currentWeek: 3,
    })
    expect(find(t, 'playoffs')!.when).toBe('WK 15-16')
    expect(find(t, 'championship')!.when).toBe('WK 17')
  })

  it('⚠ drops the bracket entirely for a league with no playoff week', () => {
    /*
     * A guillotine league eliminates a team a week and ends with one survivor.
     * "Playoffs" and "Championship" describe rounds that will never be played.
     */
    const t = buildSeasonTimeline({ settings: { trade_deadline_week: 0 }, currentWeek: 3 })
    expect(t.eliminationFormat).toBe(true)
    expect(keys(t)).not.toContain('playoffs')
    expect(keys(t)).not.toContain('championship')
    expect(keys(t)).toContain('last-standing')
  })

  it('names a confirmed guillotine league in its own language', () => {
    const t = buildSeasonTimeline({
      settings: {},
      currentWeek: 3,
      variant: 'guillotine',
    })
    expect(find(t, 'last-standing')!.label).toBe('Last one with a head')
    // And it does not hedge, because the variant is known.
    expect(t.notes.join(' ')).not.toContain('If that is wrong')
  })

  it('hedges when it INFERS elimination rather than being told', () => {
    // Absence of a playoff week is strong evidence, not proof. The note gives
    // a commissioner the way to correct it.
    const t = buildSeasonTimeline({ settings: {}, currentWeek: 3 })
    expect(find(t, 'last-standing')!.label).toBe('Last team standing')
    expect(t.notes.join(' ')).toContain('If that is wrong')
  })

  it('relabels the regular season for an elimination league', () => {
    const t = buildSeasonTimeline({ settings: {}, currentWeek: 3, variant: 'guillotine' })
    expect(find(t, 'regular')!.label).toBe('Survive')
  })

  it('adds offseason, draft and preseason before the season starts', () => {
    const t = buildSeasonTimeline({
      settings: { playoff_start_week: 15, trade_deadline_week: 11 },
      currentWeek: null,
      status: 'pre_draft',
    })
    expect(keys(t)).toContain('offseason')
    expect(keys(t)).toContain('draft')
    expect(keys(t)).toContain('preseason')
    expect(find(t, 'draft')!.state).toBe('future')
  })

  it('marks the draft as NOW while it is running', () => {
    const t = buildSeasonTimeline({ settings: {}, currentWeek: null, status: 'drafting' })
    expect(find(t, 'draft')!.label).toContain('on the clock')
    expect(find(t, 'draft')!.state).toBe('now')
  })

  it('always ends with an offseason, because the season does', () => {
    const t = buildSeasonTimeline({
      settings: { playoff_start_week: 15, playoff_teams: 4 },
      currentWeek: 16,
    })
    expect(keys(t)[keys(t).length - 1]).toBe('offseason-next')
  })

  it('marks exactly the phase the current week falls in', () => {
    const t = buildSeasonTimeline({
      settings: { playoff_start_week: 15, trade_deadline_week: 11, playoff_teams: 6 },
      currentWeek: 13,
    })
    expect(find(t, 'regular-early')!.state).toBe('past')
    expect(find(t, 'regular-late')!.state).toBe('now')
    expect(find(t, 'playoffs')!.state).toBe('future')
  })

  it('reads settings nested under a sleeper block as well as flat', () => {
    // Import paths differ on which shape they write; checking both avoids a
    // timeline that silently empties for half the leagues.
    const t = buildSeasonTimeline({
      settings: { sleeper: { playoff_start_week: 15, trade_deadline_week: 11 } },
      currentWeek: 3,
    })
    expect(find(t, 'trade-deadline')!.when).toBe('WK 11')
  })

  it('survives an empty or junk settings blob', () => {
    for (const bad of [null, undefined, 'nonsense', 42, []]) {
      const t = buildSeasonTimeline({ settings: bad, currentWeek: null })
      expect(t.phases.length).toBeGreaterThan(0)
      expect(t.notes.length).toBeGreaterThan(0)
    }
  })

  it('⚠ treats 99 as "no deadline", never as week 99', () => {
    /*
     * The platform's sentinel for "trades stay open". Four production leagues
     * carry it against 14- and 18-week regular seasons. "Trade deadline WK 99"
     * would be a checkable falsehood on a panel people plan around.
     */
    const t = buildSeasonTimeline({
      settings: { playoff_start_week: 15, trade_deadline_week: 99, regular_season_length: 14 },
      currentWeek: 3,
    })
    expect(keys(t)).not.toContain('trade-deadline')
    expect(t.notes.join(' ')).toContain('trades stay open all season')
  })

  it('treats a deadline past the end of the season as no deadline', () => {
    const t = buildSeasonTimeline({
      settings: { playoff_start_week: 15, trade_deadline_week: 17, regular_season_length: 14 },
      currentWeek: 3,
    })
    expect(keys(t)).not.toContain('trade-deadline')
  })

  it('prefers the league&apos;s own regular_season_length over re-deriving it', () => {
    // A league can carry the length without carrying the playoff week.
    const t = buildSeasonTimeline({
      settings: { regular_season_length: 18, trade_deadline_week: 12 },
      currentWeek: 3,
    })
    expect(find(t, 'regular-late')!.when).toBe('WK 13-18')
  })

  it('reads guillotineMode as a positive signal, since Sleeper imports cannot set the variant', () => {
    /*
     * The Sleeper importer can only ever write 'IDP', 'DYNASTY_IDP',
     * 'legacy_summary' or null into leagueVariant, so the boolean column is the
     * only affirmative evidence available for this format.
     */
    const t = buildSeasonTimeline({ settings: {}, currentWeek: 3, guillotineMode: true })
    expect(find(t, 'last-standing')!.label).toBe('Last one with a head')
    expect(t.notes.join(' ')).not.toContain('If that is wrong')
  })
})

describe('regularSeasonWeeks: how many weeks the week picker may offer', () => {
  it('reads the league\u2019s own length', () => {
    expect(regularSeasonWeeks({ regular_season_length: 14 })).toBe(14)
  })

  it('falls back to the week before the playoffs', () => {
    expect(regularSeasonWeeks({ playoff_start_week: 15 })).toBe(14)
    // The importer's renamed key and Sleeper's own spelling both work.
    expect(regularSeasonWeeks({ playoff_week_start: 15 })).toBe(14)
  })

  it('⚠ returns null rather than guessing 14', () => {
    /*
     * A picker offering weeks a league does not play is worse than one that
     * offers none: selecting week 17 in a 14-week league returns an empty
     * scoreboard, which is indistinguishable from broken ingestion.
     */
    expect(regularSeasonWeeks({})).toBeNull()
    expect(regularSeasonWeeks(null)).toBeNull()
  })

  it('does not treat a playoff start of week 1 as a zero-week season', () => {
    expect(regularSeasonWeeks({ playoff_start_week: 1 })).toBeNull()
  })
})
