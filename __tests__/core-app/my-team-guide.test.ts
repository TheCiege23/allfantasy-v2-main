import { describe, expect, it } from 'vitest'
import { myTeamHeadline, startersToCheck } from '@/lib/core-app/myTeamGuide'
import { myTeamGuideMessages } from '@/lib/core-app/messages/myTeamGuide'
import type { LineupCheckItem } from '@/lib/core-app/lineupCheck'

const item = (kind: LineupCheckItem['kind']): LineupCheckItem => ({
  kind,
  slotLabel: 'WR',
  name: kind === 'empty' ? null : 'Player',
  playerId: kind === 'empty' ? null : 'p',
  anchor: 'lineup-player-p',
  replacement: null,
})

describe('myTeamHeadline', () => {
  it('a starter out, on bye or an empty slot is something to FIX, and beats everything else', () => {
    expect(myTeamHeadline({ bestBall: false, check: { items: [item('questionable'), item('out'), item('empty')] } })).toEqual({ kind: 'fix', count: 2 })
    expect(myTeamHeadline({ bestBall: false, check: { items: [item('bye')] } })).toEqual({ kind: 'fix', count: 1 })
  })

  it('questionable starters leave the lineup set but say how many to watch', () => {
    expect(myTeamHeadline({ bestBall: false, check: { items: [item('questionable'), item('questionable')] } })).toEqual({ kind: 'questionable', count: 2 })
  })

  it('a clear optimizer gain says so; a gain inside the margin does not', () => {
    expect(myTeamHeadline({ bestBall: false, check: { items: [] }, optimizer: { state: 'improve', gain: 6.4, verdict: 'clear' } })).toEqual({ kind: 'better', gain: 6.4 })
    expect(myTeamHeadline({ bestBall: false, check: { items: [] }, optimizer: { state: 'improve', gain: 1.5, verdict: 'close' } })).toEqual({ kind: 'set' })
    expect(myTeamHeadline({ bestBall: false, check: { items: [] }, optimizer: { state: 'optimal', gain: 0 } })).toEqual({ kind: 'set' })
  })

  it('Best Ball has nothing to set, and no readable starters is not "set"', () => {
    expect(myTeamHeadline({ bestBall: true, check: { items: [item('out')] } })).toEqual({ kind: 'auto' })
    expect(myTeamHeadline({ bestBall: false, check: null })).toEqual({ kind: 'unknown' })
  })
})

describe('startersToCheck', () => {
  it('counts certain problems and questionable starters, not advisory swaps', () => {
    expect(startersToCheck({ items: [item('out'), item('questionable'), item('swap')] })).toBe(2)
    expect(startersToCheck(null)).toBe(0)
  })
})

describe('my team guide copy', () => {
  it('reads plainly in both languages and never says «waiver» in Spanish', () => {
    expect(myTeamGuideMessages.en.headFix(1)).toBe('Fix 1 starter before kickoff')
    expect(myTeamGuideMessages.en.headQuestionable(2)).toBe('Your lineup is set · 2 starters are questionable')
    const es = JSON.stringify(Object.values(myTeamGuideMessages.es!).map((v) => (typeof v === 'function' ? String(v) : v)))
    expect(es.toLowerCase()).not.toMatch(/waiver/)
  })
})
