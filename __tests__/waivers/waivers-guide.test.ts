import { describe, expect, it } from 'vitest'
import { waiverPick } from '@/lib/core-app/waiversGuide'
import { waiversGuideMessages } from '@/lib/core-app/messages/waiversGuide'
import type { WaiverBoard } from '@/lib/waivers/waiverBoard'

const cand = (name: string, gain: number, displaces: string | null) =>
  ({
    sleeperId: null,
    name,
    position: 'TE',
    team: 'X',
    projectedPoints: 10,
    gain,
    displaces: displaces ? { sleeperId: null, name: displaces, projectedPoints: 9 } : null,
    basis: 'projection',
  }) as WaiverBoard['candidates'][number]

describe('waiverPick', () => {
  it('names the top-ranked add, what he adds and whom he replaces', () => {
    const pick = waiverPick({ state: 'ok', candidates: [cand('Pat Freiermuth', 1.2, 'Rico Dowdle'), cand('Brenton Strange', 1.1, 'Rico Dowdle')] } as WaiverBoard)
    expect(pick).toEqual({ kind: 'best', name: 'Pat Freiermuth', gain: 1.2, replaces: 'Rico Dowdle', perGame: false, count: 2 })
  })

  it('an empty slot has nobody to replace', () => {
    expect(waiverPick({ state: 'ok', candidates: [cand('Open Slot Guy', 9.4, null)] } as WaiverBoard)).toMatchObject({ kind: 'best', replaces: null })
  })

  it('says "nobody helps" only when the wire was ranked, and never guesses while loading or unranked', () => {
    expect(waiverPick({ state: 'ok', candidates: [] } as unknown as WaiverBoard)).toEqual({ kind: 'none', perGame: false })
    expect(waiverPick({ state: 'no_team_claimed', candidates: [] } as unknown as WaiverBoard)).toEqual({ kind: 'unranked' })
    expect(waiverPick(null)).toEqual({ kind: 'pending' })
  })
})

describe('waivers guide copy', () => {
  it('reads plainly in both languages and never says «waiver» in Spanish', () => {
    expect(waiversGuideMessages.en.headBest('Pat Freiermuth', '1.2', false)).toBe('Best pickup: Pat Freiermuth, +1.2 points this week')
    expect(waiversGuideMessages.en.headBest('X', '0.4', true)).toBe('Best pickup: X, +0.4 points a game')
    const es = JSON.stringify(Object.values(waiversGuideMessages.es!).map((v) => (typeof v === 'function' ? String(v) : v)))
    expect(es.toLowerCase()).not.toMatch(/waiver/)
  })
})
