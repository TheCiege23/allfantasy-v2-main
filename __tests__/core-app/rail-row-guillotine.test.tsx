import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RailRowBody, mergeRailMatchup } from '@/components/core-app/RailRowBody'
import type { RailMatchupSummary } from '@/components/core-app/AfCoreShell'
import type { RailGuillotineLine } from '@/lib/core-app/railGuillotineLine'

/*
 * The rail row for a NATIVE guillotine league (2026-10-18): it read "no head-to-head on file this
 * week". It now draws your points and projection, then — where an opponent would sit — your place
 * among the survivors and the distance to the chop line. One component, so /core and the league page
 * show the same words.
 */

const line = (over: Partial<RailGuillotineLine>): RailGuillotineLine => ({
  state: 'alive', week: 11, points: 100, projected: 120, rank: 8, aliveCount: 16, chopMargin: 12.4,
  basis: 'points', firstChopWeek: 10, choppedWeek: null, draftAt: null, ...over,
})

const matchup = (g: RailGuillotineLine): RailMatchupSummary => ({
  season: 2026, week: g.week ?? 0, yourTeam: 'Ciege Squad', yourAvatarUrl: null, yourScore: g.points ?? 0,
  yourProjection: g.projected != null ? { projected: g.projected, afProjected: null, afEngine: null, afEngineFrom: 0, pricedFrom: 9, starterCount: 10 } : null,
  opponentTeam: null, opponentAvatarUrl: null, opponentScore: 0, opponentProjection: null,
  unpaired: true, standing: null, scored: g.points != null, freshAt: '2026-10-18T12:00:00.000Z', source: 'live_cache',
  guillotine: g, native: true,
})

const draw = (g: RailGuillotineLine) =>
  render(<RailRowBody name="9626 Guilly" platform="native" m={matchup(g)} freshMinutes={2} showScoreStatus />).container

const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ')

describe('RailRowBody — native guillotine line', () => {
  it('alive: points, projection, rank among the alive, distance above the chop', () => {
    const el = draw(line({}))
    expect(text(el)).toContain('100.0')
    expect(text(el)).toContain('120.0')
    expect(text(el)).toContain('8th of 16 alive')
    expect(text(el)).toContain('+12.4 above chop')
    expect(text(el)).toContain('on points')
    expect(text(el)).not.toContain('no head-to-head')
    expect(el.querySelector('[data-guillotine="alive"]')).not.toBeNull()
  })

  it('chop zone: says so, with the deficit to safety, in the bad tone', () => {
    const el = draw(line({ state: 'chop_zone', rank: 16, chopMargin: -3.2, points: 84 }))
    expect(text(el)).toContain('16th of 16 alive')
    expect(text(el)).toContain('in the chop zone')
    expect(text(el)).toContain('-3.2 to safety')
    expect(el.querySelector('[data-guillotine="chop_zone"]')?.getAttribute('data-tone')).toBe('bad')
  })

  it('eliminated: "Chopped wk N" and no score', () => {
    const el = draw(line({ state: 'eliminated', choppedWeek: 10, rank: null, chopMargin: null, points: null, projected: null, basis: null }))
    expect(text(el)).toContain('Chopped wk 10')
    // No score at all — not a 0.0 that would read as a played week.
    expect(el.querySelector('.af-rail-row-score')).toBeNull()
  })

  it('before the first chop week: names it', () => {
    const el = draw(line({ state: 'before_first_chop', week: 3 }))
    expect(text(el)).toContain('First chop wk 10')
    expect(text(el)).toContain('8th of 16 alive')
  })

  it('no scores yet: a dash for points and no invented rank', () => {
    const el = draw(line({ state: 'no_scores', rank: null, chopMargin: null, points: null, projected: null, basis: null }))
    expect(text(el)).toContain('16 alive')
    expect(text(el)).toContain('no scores yet')
    expect(el.querySelector('.af-rail-row-score')).toBeNull()
  })

  it('preseason: draft time, else "Season not started"', () => {
    const withDraft = draw(line({ state: 'preseason', week: null, rank: null, points: null, projected: null, draftAt: '2026-10-20T00:00:00.000Z' }))
    expect(text(withDraft)).toMatch(/Draft \w{3} \d{1,2}(:\d{2})?[ap]m/)
    expect(text(withDraft)).toContain('first chop wk 10')
    const noDraft = draw(line({ state: 'preseason', week: null, rank: null, points: null, projected: null, draftAt: null }))
    expect(text(noDraft)).toContain('Season not started')
  })

  it('a live native poll replaces the snapshot whole, keeping its own projection and data stamp', () => {
    const saved = matchup(line({}))
    const live = { ...matchup(line({ points: 130.5, rank: 2, chopMargin: 43 })), yourScore: 130.5, season: 2026, week: 11, updatedAt: '2026-10-18T12:05:00.000Z', freshAt: '2026-10-18T12:04:00.000Z' }
    const merged = mergeRailMatchup(saved, live as never)
    expect(merged?.guillotine).toMatchObject({ points: 130.5, rank: 2 })
    expect(merged?.yourProjection?.projected).toBe(120)
    expect(merged?.freshAt).toBe('2026-10-18T12:04:00.000Z')
  })
})

/*
 * An IMPORTED (Sleeper) guillotine league draws `standing`, not the native line. Owner's report 2026-10-30:
 * week 8, 11 alive, 11 weeks left — the card read "T-7th of 18 · tied lowest · on points" before kickoff.
 */
describe('RailRowBody — imported guillotine standing', () => {
  const standing = (over: Partial<NonNullable<RailMatchupSummary['standing']>> = {}): NonNullable<RailMatchupSummary['standing']> => ({
    rank: 4, outOf: 11, overCut: 21.5, basis: 'projected', placesAboveCut: 7, cutLine: 111.7, elimination: true,
    played: 0, cutTeam: 'Bench Mob', cutTeamValue: 111.7, weeksLeft: 11, ...over,
  })
  const saved = (s: NonNullable<RailMatchupSummary['standing']>): RailMatchupSummary => ({
    season: 2026, week: 8, yourTeam: 'TheCiege24', yourAvatarUrl: null, yourScore: 0,
    yourProjection: { projected: 133.2, afProjected: null, afEngine: null, afEngineFrom: 0, pricedFrom: 9, starterCount: 9 },
    opponentTeam: null, opponentAvatarUrl: null, opponentScore: 0, opponentProjection: null,
    unpaired: true, standing: s, scored: false, freshAt: null, source: 'live_cache',
  })
  const drawStanding = (m: RailMatchupSummary) =>
    render(<RailRowBody name="BB Guilly" platform="sleeper" m={m} freshMinutes={2} showScoreStatus />).container

  it('counts the alive, names the chop line and the weeks left', () => {
    const c = drawStanding(saved(standing()))
    expect(text(c.querySelector('.af-rail-row-rank-pos')!)).toBe('4th of 11 alive')
    expect(c.querySelector('.af-rail-row-rank-low')?.textContent).toBe('Lowest: Bench Mob · 111.7')
    expect(c.querySelector('.af-rail-row-rank-basis')?.textContent).toBe('on projection · 11 weeks left')
  })

  it('at the bottom, names the team to pass instead', () => {
    const c = drawStanding(saved(standing({ rank: 11, overCut: null, placesAboveCut: 0, cutTeam: 'Late Sunday', cutTeamValue: 118.2 })))
    expect(c.querySelector('.af-rail-row-rank-low')?.textContent).toBe('To pass: Late Sunday · 118.2')
  })

  it('a best-ball league says its rank is a projected final, provisional until the last game', () => {
    const provisional = drawStanding(saved(standing({ basis: 'best_ball', provisional: true })))
    expect(provisional.querySelector('.af-rail-row-rank-basis')?.textContent).toBe('on projected best-ball final · provisional · 11 weeks left')
    const final = drawStanding(saved(standing({ basis: 'best_ball', provisional: false })))
    expect(final.querySelector('.af-rail-row-rank-basis')?.textContent).toBe('on final best-ball points · 11 weeks left')
  })

  it('a head-to-head-less redraft league keeps its old line: no "alive", no chop line', () => {
    const c = drawStanding(saved(standing({ elimination: false, outOf: 12 })))
    expect(text(c.querySelector('.af-rail-row-rank-pos')!)).toBe('4th of 12')
    expect(c.querySelector('.af-rail-row-rank-low')).toBeNull()
  })

  const live = (over: Record<string, unknown>) => ({
    season: 2026, week: 8, updatedAt: '2026-10-30T23:00:00.000Z', yourTeam: 'TheCiege24', yourAvatarUrl: null, yourScore: 0,
    opponentTeam: null, opponentAvatarUrl: null, opponentScore: 0, unpaired: true, scored: true,
    fieldStanding: { rank: 6, outOf: 11, overCut: null, basis: 'points', placesAboveCut: 0, cutLine: 0, tied: true, elimination: true, played: 5, cutTeam: 'Late Sunday', cutTeamValue: 0, weeksLeft: 11 },
    standing: null, ...over,
  })

  it('a live poll before most of the field has played keeps the projected rank (5 of 11 is not most)', () => {
    const merged = mergeRailMatchup(saved(standing()), live({}) as never)
    expect(merged?.standing).toMatchObject({ basis: 'projected', rank: 4, outOf: 11, weeksLeft: 11 })
    expect(merged?.yourScore).toBe(0)
  })

  it('a best-ball rank is never replaced by the live points rank, however many have played', () => {
    const merged = mergeRailMatchup(saved(standing({ basis: 'best_ball', provisional: true })), live({ fieldStanding: { ...live({}).fieldStanding, played: 11, rank: 10 } }) as never)
    expect(merged?.standing).toMatchObject({ basis: 'best_ball', rank: 4, provisional: true })
  })

  it('once most have played (6 of 11), the live points rank takes over', () => {
    const merged = mergeRailMatchup(saved(standing()), live({ fieldStanding: { ...live({}).fieldStanding, played: 6, rank: 9, overCut: 4.1, tied: false } }) as never)
    expect(merged?.standing).toMatchObject({ basis: 'points', rank: 9, played: 6 })
  })
})
