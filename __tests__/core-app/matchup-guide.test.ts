import { describe, expect, it } from 'vitest'
import { matchupHeadline, pct } from '@/lib/core-app/matchupGuide'
import { matchupGuideMessages } from '@/lib/core-app/messages/matchupGuide'

const proj = { you: 132.2, opponent: 125.9 }

describe('matchupHeadline', () => {
  it('a finished week says who won, on the scored totals', () => {
    expect(matchupHeadline({ weekState: 'final', scored: { you: 112.4, opponent: 104.9 }, projected: proj, pWin: 0.6 })).toEqual({ kind: 'final', result: 'won', you: 112.4, them: 104.9 })
    expect(matchupHeadline({ weekState: 'final', scored: { you: 90, opponent: 104.9 }, projected: proj, pWin: 0.6 })).toMatchObject({ result: 'lost' })
  })

  it('a live week leads with the scored margin, never the projection', () => {
    expect(matchupHeadline({ weekState: 'live', scored: { you: 38.8, opponent: 46.2 }, projected: proj, pWin: 0.59 })).toEqual({ kind: 'live', leader: 'them', margin: expect.closeTo(7.4, 5), pWin: 0.59 })
  })

  it('before kickoff it is the projection, said as one', () => {
    expect(matchupHeadline({ weekState: 'upcoming', scored: null, projected: proj, pWin: 0.59 })).toEqual({ kind: 'projected', leader: 'you', you: 132.2, them: 125.9, pWin: 0.59 })
    expect(matchupHeadline({ weekState: 'upcoming', scored: null, projected: null, pWin: null })).toEqual({ kind: 'unknown' })
  })
})

describe('pct', () => {
  it('rounds, and never prints a missing probability as 0%', () => {
    expect(pct(0.594)).toBe(59)
    expect(pct(null)).toBeNull()
    expect(pct(Number.NaN)).toBeNull()
  })
})

describe('matchup guide copy', () => {
  it('reads plainly in both languages and never says «waiver» in Spanish', () => {
    expect(matchupGuideMessages.en.liveBehind('7.4')).toBe('Behind by 7.4 so far')
    expect(matchupGuideMessages.en.projWin('132.2', '125.9') + matchupGuideMessages.en.chanceSuffix(59)).toBe('Projected to win, 132.2–125.9 · 59% chance')
    const es = JSON.stringify(Object.values(matchupGuideMessages.es!).map((v) => (typeof v === 'function' ? String(v) : v)))
    expect(es.toLowerCase()).not.toMatch(/waiver/)
  })
})
