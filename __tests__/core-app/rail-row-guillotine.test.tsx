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
    expect(el.querySelector('.af-rail-row-score')?.textContent).toBe('—')
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
    expect(el.querySelector('.af-rail-row-score')?.textContent).toBe('—')
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
