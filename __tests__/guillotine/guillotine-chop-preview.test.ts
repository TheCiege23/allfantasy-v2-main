/**
 * Chop week preview (2026-10-25): this week's chop on the scores as they stand, by the engine's own
 * rules, writing nothing (lib/guillotine/chopPreview.ts).
 */
import { describe, expect, it } from 'vitest'
import { buildChopPreview, type ChopPreviewInput, type ChopPreviewTeam } from '@/lib/guillotine/chopPreview'
import { DEFAULT_ADVANCED } from '@/lib/guillotine/chopSchedule'
import { chopAnnouncementText } from '@/lib/guillotine/chopAnnouncement'

const team = (rosterId: string, periodPoints: number, over: Partial<ChopPreviewTeam> = {}): ChopPreviewTeam => ({
  rosterId, name: rosterId.toUpperCase(), periodPoints, seasonPointsCumul: periodPoints, faab: 100, playerCount: 9, ...over,
})

const input = (over: Partial<ChopPreviewInput> = {}): ChopPreviewInput => ({
  week: 3,
  weekState: 'final',
  eliminationStartWeek: 1,
  eliminationEndWeek: 17,
  teamsPerChop: 1,
  advanced: DEFAULT_ADVANCED,
  endgame: { format: 'last_team_standing', threshold: 1 },
  tiebreakerOrder: ['bench_points', 'season_points', 'random'],
  dangerMarginPoints: 10,
  faabOnChop: 'keep',
  rosterReleaseTiming: 'next_waiver_run',
  teams: [team('a', 120), team('b', 95), team('c', 90), team('d', 140)],
  previousWeek: [],
  draftSlotByRoster: new Map(),
  blockers: [],
  ...over,
})

describe('buildChopPreview', () => {
  it('names the lowest scorer, the danger zone and what reaches waivers', () => {
    const p = buildChopPreview(input())
    expect(p.outcome).toBe('chop')
    expect(p.headline).toBe('Week 3 is final: C will be chopped when the correction window closes.')
    expect(p.rows.map((r) => [r.rosterId, r.status])).toEqual([['c', 'chopped'], ['b', 'danger'], ['a', 'safe'], ['d', 'safe']])
    expect(p.chopLine).toBe(90)
    expect(p.rows.find((r) => r.rosterId === 'b')!.margin).toBe(5)
    expect(p.release).toEqual({ players: 9, when: 'At the next waiver run' })
    expect(p.announcement).toBe(chopAnnouncementText(3, ['C']))
  })

  it('splits the chopped team\'s FAAB the way the chop does, and says where it goes', () => {
    const p = buildChopPreview(input({ faabOnChop: 'split', teams: [team('a', 120, { faab: 40 }), team('b', 95, { faab: 10 }), team('c', 90, { faab: 61 }), team('d', 140, { faab: 0 })] }))
    expect(p.faab).toEqual({ mode: 'split', pool: 61, note: '$61 is shared by the 3 survivors.' })
    // floor(61/3) = 20 each, the extra dollar to the lowest balance (d, $0).
    expect(Object.fromEntries(p.rows.map((r) => [r.rosterId, r.faabChange]))).toEqual({ c: -61, b: 20, a: 20, d: 21 })
  })

  it('"keep" says the FAAB leaves with the team and moves nothing', () => {
    const p = buildChopPreview(input())
    expect(p.faab).toEqual({ mode: 'keep', pool: 100, note: '$100 leaves the league with the chopped team.' })
    expect(p.rows.every((r) => r.faabChange == null)).toBe(true)
  })

  it('no FAAB line when the league has no budget', () => {
    const p = buildChopPreview(input({ teams: input().teams.map((t) => ({ ...t, faab: null })) }))
    expect(p.faab).toBeNull()
  })

  it('follows the commissioner\'s schedule: double-chop weeks and no-chop weeks', () => {
    const advanced = { ...DEFAULT_ADVANCED, overrides: { 3: 2 } }
    const double = buildChopPreview(input({ advanced }))
    expect(double.chopCount).toBe(2)
    expect(double.rows.filter((r) => r.status === 'chopped').map((r) => r.rosterId)).toEqual(['c', 'b'])
    const none = buildChopPreview(input({ advanced: { ...DEFAULT_ADVANCED, overrides: { 3: 0 } } }))
    expect(none.outcome).toBe('no_chop_week')
    expect(none.rows).toEqual([])
  })

  it('last week\'s top scorer is immune when immunity is on', () => {
    const p = buildChopPreview(input({ advanced: { ...DEFAULT_ADVANCED, immunity: 'top_scorer' }, previousWeek: [{ rosterId: 'c', periodPoints: 150 }, { rosterId: 'a', periodPoints: 80 }] }))
    expect(p.rows.find((r) => r.rosterId === 'c')!.status).toBe('immune')
    expect(p.rows.find((r) => r.rosterId === 'b')!.status).toBe('chopped')
    expect(p.notes).toContain("C is immune as last week's top scorer.")
  })

  it('a tie on the line uses the league\'s tiebreak order', () => {
    const p = buildChopPreview(input({ teams: [team('a', 90, { benchPoints: 30 }), team('b', 90, { benchPoints: 12 }), team('d', 140)] }))
    expect(p.rows.find((r) => r.rosterId === 'b')!.status).toBe('chopped')
    expect(p.tiebreak).toBe('Fewer bench points is chopped')
  })

  it('a live week says the order can still change', () => {
    const p = buildChopPreview(input({ weekState: 'live' }))
    expect(p.headline).toBe('If week 3 ended now, C would be chopped.')
    expect(p.notes[0]).toMatch(/still being played/)
  })

  it('never chops below the endgame: a final-four league with four left goes to the final stage', () => {
    const p = buildChopPreview(input({ endgame: { format: 'final_four', threshold: 4 } }))
    expect(p.outcome).toBe('final_stage')
    expect(p.rows).toEqual([])
  })

  it('before the first chop week and after the last', () => {
    expect(buildChopPreview(input({ eliminationStartWeek: 5 })).outcome).toBe('before_first_chop')
    expect(buildChopPreview(input({ week: 18 })).outcome).toBe('past_last_chop')
  })

  it('passes the loader\'s blockers through', () => {
    const p = buildChopPreview(input({ blockers: ['Team X can\'t be matched.'] }))
    expect(p.blockers).toEqual(['Team X can\'t be matched.'])
  })
})
