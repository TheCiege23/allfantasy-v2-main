import { describe, expect, it } from 'vitest'
import {
  boxScorePositionEvidence,
  parseListedNbaPositions,
  planEligibilityChange,
  resolveLeagueEligibility,
  resolvePlayerEligibility,
  withEffectivePositions,
  type EligibilityChange,
} from '@/lib/league-eligibility/nbaPositionEligibility'
import { playerEligibleForSlot } from '@/lib/league/lineup-swap'
import { collectTemplateSectionIssues, getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'

const change = (position: EligibilityChange['position'], action: EligibilityChange['action'], at: string): EligibilityChange => ({
  playerId: 'amen',
  playerName: 'Amen Thompson',
  position,
  action,
  reason: action === 'reset' ? null : 'test',
  actorUserId: 'commish',
  createdAt: at,
})

describe('parseListedNbaPositions', () => {
  it('reads every spelling our sources write', () => {
    expect(parseListedNbaPositions('PG,SG')).toEqual(['PG', 'SG'])
    expect(parseListedNbaPositions('SF/PF')).toEqual(['SF', 'PF'])
    expect(parseListedNbaPositions('G')).toEqual(['PG', 'SG'])
    expect(parseListedNbaPositions('F')).toEqual(['SF', 'PF'])
    expect(parseListedNbaPositions('FC')).toEqual(['PF', 'C'])
    expect(parseListedNbaPositions('Center')).toEqual(['C'])
  })
  it('drops what it cannot name instead of guessing', () => {
    expect(parseListedNbaPositions('UTIL')).toEqual([])
    expect(parseListedNbaPositions(null)).toEqual([])
  })
})

describe('resolvePlayerEligibility', () => {
  it('adds a position the player is not listed at', () => {
    const s = resolvePlayerEligibility('PG', [change('SF', 'add', '2026-11-01')])
    expect(s).toEqual({ listed: ['PG'], added: ['SF'], removed: [], effective: ['PG', 'SF'] })
  })

  it('REMOVES a listed position, which Yahoo commissioners cannot do', () => {
    const s = resolvePlayerEligibility('PG,SG', [change('PG', 'remove', '2026-11-01')])
    expect(s.removed).toEqual(['PG'])
    expect(s.effective).toEqual(['SG'])
  })

  it('applies the log in time order, whatever order it arrives in', () => {
    const s = resolvePlayerEligibility('PG', [change('SF', 'remove', '2026-11-03'), change('SF', 'add', '2026-11-01')])
    expect(s.effective).toEqual(['PG'])
  })

  it('reset puts the listed position back in charge', () => {
    const s = resolvePlayerEligibility('PG', [change('PG', 'remove', '2026-11-01'), change('SF', 'add', '2026-11-01'), change('PG', 'reset', '2026-11-02')])
    expect(s.effective).toEqual(['PG', 'SF'])
    expect(s.removed).toEqual([])
  })

  it('an add the provider later lists becomes plain listed, not a duplicate', () => {
    const s = resolvePlayerEligibility('PG,SF', [change('SF', 'add', '2026-11-01')])
    expect(s.added).toEqual([])
    expect(s.effective).toEqual(['PG', 'SF'])
  })
})

describe('resolveLeagueEligibility', () => {
  it('returns only players with a change still in force', () => {
    const states = resolveLeagueEligibility(
      [change('SF', 'add', '2026-11-01'), { ...change('C', 'add', '2026-11-01'), playerId: 'x' }, { ...change('C', 'reset', '2026-11-02'), playerId: 'x' }],
      new Map([['amen', 'PG'], ['x', 'PF']]),
    )
    expect([...states.keys()]).toEqual(['amen'])
  })
})

describe('planEligibilityChange', () => {
  const base = { playerId: 'amen', playerName: 'Amen Thompson', listedRaw: 'PG', history: [] as EligibilityChange[] }

  it('requires a reason the league will read', () => {
    expect(planEligibilityChange({ ...base, position: 'SF', action: 'add', reason: '  ' })).toEqual({ ok: false, error: 'Add a short reason. League members see it.' })
  })
  it('refuses to remove the last position', () => {
    const r = planEligibilityChange({ ...base, position: 'PG', action: 'remove', reason: 'x' })
    expect(r.ok).toBe(false)
  })
  it('refuses a no-op so the public log stays meaningful', () => {
    expect(planEligibilityChange({ ...base, position: 'PG', action: 'add', reason: 'x' }).ok).toBe(false)
    expect(planEligibilityChange({ ...base, position: 'SF', action: 'reset' }).ok).toBe(false)
  })
  it('refuses a position that is not a basketball position', () => {
    expect(planEligibilityChange({ ...base, position: 'UTIL', action: 'add', reason: 'x' }).ok).toBe(false)
    expect(planEligibilityChange({ ...base, position: 'G', action: 'add', reason: 'x' }).ok).toBe(false)
  })
  it('plans a valid add and reports the result', () => {
    const r = planEligibilityChange({ ...base, position: 'sf', action: 'add', reason: '10 straight starts at SF' })
    expect(r.ok && r.next.effective).toEqual(['PG', 'SF'])
    expect(r.ok && r.change.position).toBe('SF')
  })
})

describe('boxScorePositionEvidence', () => {
  it('counts games by the position the box score listed, most first', () => {
    const ev = boxScorePositionEvidence([{ position: 'SF' }, { position: 'PG' }, { position: 'SF' }, { position: null }])
    expect(ev).toEqual([{ position: 'SF', games: 2 }, { position: 'PG', games: 1 }])
  })
})

describe('lineup slots read a comma-joined position', () => {
  const slot = (allowedPositions: string[]) => ({ allowedPositions }) as never
  it('"PG,SF" fits a SF slot and a G slot, not a C slot', () => {
    expect(playerEligibleForSlot(slot(['SF', 'F']), 'PG,SF')).toBe(true)
    expect(playerEligibleForSlot(slot(['PG', 'SG', 'G']), 'PG,SF')).toBe(true)
    expect(playerEligibleForSlot(slot(['C']), 'PG,SF')).toBe(false)
  })
  it('a slash is NOT a separator: D/ST keeps meaning one position', () => {
    expect(playerEligibleForSlot(slot(['DEF', 'D/ST']), 'D/ST')).toBe(true)
    expect(playerEligibleForSlot(slot(['D']), 'D/ST')).toBe(false)
  })
  it('a single position behaves exactly as before', () => {
    expect(playerEligibleForSlot(slot(['PG', 'G']), 'PG')).toBe(true)
    expect(playerEligibleForSlot(slot(['C']), 'PG')).toBe(false)
    expect(playerEligibleForSlot(slot(['C']), '')).toBe(false)
  })
})

describe('withEffectivePositions (server-side lineup check)', () => {
  const playerData = {
    lineup_sections: {
      starters: [{ id: 'amen', position: 'PG', slotIndex: 2 }, { id: 'other', position: 'C', slotIndex: 4 }],
      bench: [{ id: 'bench1', position: 'SG' }],
    },
  }
  it('rewrites only changed players, and leaves the input untouched', () => {
    const out = withEffectivePositions(playerData, new Map([['amen', 'PG,SF']]))
    const sections = getNormalizedLineupSections(out)
    expect(sections.starters.map((r) => r.position)).toEqual(['PG,SF', 'C'])
    expect(sections.bench.map((r) => r.position)).toEqual(['SG'])
    expect(playerData.lineup_sections.starters[0].position).toBe('PG')
  })
  it('a client that still sends the removed position is checked against the log', () => {
    const forged = { lineup_sections: { starters: [{ id: 'amen', position: 'PG,SF,C', slotIndex: 0 }] } }
    const out = withEffectivePositions(forged, new Map([['amen', 'SF']]))
    expect(getNormalizedLineupSections(out).starters[0].position).toBe('SF')
  })
  it('the template check accepts a multi-position starter when any one fits', () => {
    const template = {
      templateId: 't',
      slots: [
        { slotName: 'PG', allowedPositions: ['PG'], starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0 },
        { slotName: 'BN', allowedPositions: ['*'], starterCount: 0, benchCount: 5, reserveCount: 0, taxiCount: 0, devyCount: 0 },
      ],
    } as never
    const issues = collectTemplateSectionIssues({ lineup_sections: { starters: [{ id: 'a', position: 'SF,PG' }] } }, template)
    expect(issues.filter((i) => i.code === 'STARTER_POSITION_INELIGIBLE')).toEqual([])
    const bad = collectTemplateSectionIssues({ lineup_sections: { starters: [{ id: 'a', position: 'SF,C' }] } }, template)
    expect(bad.filter((i) => i.code === 'STARTER_POSITION_INELIGIBLE')).toHaveLength(1)
  })
})
