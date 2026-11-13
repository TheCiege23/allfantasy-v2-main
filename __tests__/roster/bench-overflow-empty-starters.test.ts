import { describe, expect, it } from 'vitest'
import { benchCapacityWithEmptyStarters } from '@/lib/roster/benchCapacity'
import { collectTemplateSectionIssues } from '@/lib/roster/LineupTemplateValidation'
import { validateRedraftLineup, type RedraftLineupPlayer } from '@/lib/redraft/lineupValidation'
import { resolveRedraftRosterConfig } from '@/lib/redraft/rosterConfigResolver'
import type { RosterTemplateDto } from '@/lib/multi-sport/RosterTemplateService'

/*
 * Found by the dynasty simulation (2026-11-09): an auction team finished with 25 players and no
 * quarterback. With the QB slot empty its 25th player could only sit on the bench as the 16th of 15,
 * and every lineup that manager tried to save was refused — until a QB arrived.
 */

describe('benchCapacityWithEmptyStarters', () => {
  it('adds one bench place per empty starting slot, and none for a full lineup', () => {
    expect(benchCapacityWithEmptyStarters({ benchSlots: 15, starterSlots: 10, startersFilled: 9 })).toBe(16)
    expect(benchCapacityWithEmptyStarters({ benchSlots: 15, starterSlots: 10, startersFilled: 10 })).toBe(15)
    // Over-filled starters are their own error elsewhere; they never shrink the bench.
    expect(benchCapacityWithEmptyStarters({ benchSlots: 15, starterSlots: 10, startersFilled: 12 })).toBe(15)
  })
})

// ── The lineup save path: lineupService → validateCanonicalRosterPayload → collectTemplateSectionIssues ──

const template = {
  templateId: 't', sportType: 'NFL', name: 't', formatType: 'standard',
  slots: [
    { slotName: 'QB', starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, allowedPositions: ['QB'] },
    { slotName: 'RB', starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, allowedPositions: ['RB'] },
    { slotName: 'WR', starterCount: 3, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, allowedPositions: ['WR'] },
    { slotName: 'TE', starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, allowedPositions: ['TE'] },
    { slotName: 'FLEX', starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0, allowedPositions: ['RB', 'WR', 'TE'] },
    { slotName: 'BN', starterCount: 0, benchCount: 15, reserveCount: 0, taxiCount: 0, devyCount: 0, allowedPositions: ['QB', 'RB', 'WR', 'TE'] },
  ],
} as unknown as RosterTemplateDto

const players = (prefix: string, position: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i + 1}`, position }))

/** 8 starting slots, a 15-man bench, 23 in all. */
function lineup(starters: Array<{ id: string; position: string }>, bench: Array<{ id: string; position: string }>) {
  return { lineup_sections: { starters, bench, ir: [], taxi: [], devy: [] } }
}
const noQbStarters = [...players('rb', 'RB', 2), ...players('wr', 'WR', 3), ...players('te', 'TE', 1), { id: 'flex-1', position: 'RB' }]
const fullStarters = [{ id: 'qb-1', position: 'QB' }, ...noQbStarters]

describe('the lineup save: a team with an empty starting slot', () => {
  it('saves with a QB-less roster — the empty slot\'s player sits on the bench as its 16th', () => {
    const issues = collectTemplateSectionIssues(lineup(noQbStarters, players('bn', 'WR', 16)), template)
    expect(issues.map((i) => i.code)).not.toContain('SECTION_OVERFLOW')
    expect(issues.map((i) => i.code)).not.toContain('ROSTER_TOTAL_OVER_LIMIT')
  })

  it('still refuses a bench beyond the empty seats', () => {
    const issues = collectTemplateSectionIssues(lineup(noQbStarters, players('bn', 'WR', 17)), template)
    expect(issues).toContainEqual(expect.objectContaining({ code: 'SECTION_OVERFLOW', section: 'bench', message: 'BENCH has 17 players, max 16.' }))
  })

  it('still refuses a 16-man bench behind a FULL lineup', () => {
    const issues = collectTemplateSectionIssues(lineup(fullStarters, players('bn', 'WR', 16)), template)
    expect(issues).toContainEqual(expect.objectContaining({ code: 'SECTION_OVERFLOW', section: 'bench', message: 'BENCH has 16 players, max 15.' }))
  })
})

// ── The season roster path (/api/redraft/roster → validateRedraftLineup) ──

function p(overrides: Partial<RedraftLineupPlayer> & Pick<RedraftLineupPlayer, 'playerId' | 'position' | 'slotType'>): RedraftLineupPlayer {
  return { playerName: overrides.playerId, sport: 'NFL', injuryStatus: null, byeWeek: null, isLocked: false, ...overrides }
}
const starters = [
  p({ playerId: 'rb-1', position: 'RB', slotType: 'RB' }),
  p({ playerId: 'rb-2', position: 'RB', slotType: 'RB' }),
  p({ playerId: 'wr-1', position: 'WR', slotType: 'WR' }),
  p({ playerId: 'wr-2', position: 'WR', slotType: 'WR' }),
  p({ playerId: 'te-1', position: 'TE', slotType: 'TE' }),
  p({ playerId: 'flex-1', position: 'RB', slotType: 'FLEX' }),
  p({ playerId: 'k-1', position: 'K', slotType: 'K' }),
  p({ playerId: 'def-1', position: 'DEF', slotType: 'DEF' }),
]
/** The sport's own starting slots, a one-man bench, and room for exactly one more player. */
function config() {
  const base = resolveRedraftRosterConfig('NFL', null)
  const starterSlots = [...base.starterCapacities.values()].reduce((a, b) => a + b, 0)
  return { ...base, benchSlots: 1, irSlots: 0, taxiSlots: 0, maxRosterSize: starterSlots + 1 }
}

describe('the season lineup: a team with an empty starting slot', () => {
  it('a slot nobody on the roster can play is a warning, and the lineup saves', () => {
    const rows = [...starters, p({ playerId: 'bn-1', position: 'WR', slotType: 'bench' }), p({ playerId: 'bn-2', position: 'RB', slotType: 'bench' })]
    const result = validateRedraftLineup({ sport: 'NFL', week: 4, players: rows, rosterConfig: config() })
    expect(result.ok).toBe(true)
    const byCode = new Map(result.issues.map((i) => [i.code, i]))
    expect(byCode.get('missing_required_position')).toMatchObject({ severity: 'warning', message: expect.stringContaining('nobody on the roster plays it') })
    expect(byCode.get('missing_starter_slot')).toMatchObject({ severity: 'warning', slotType: 'QB' })
    expect(byCode.has('bench_slot_overflow')).toBe(false)
  })

  it('a slot a bench player COULD fill is still an error — benching the QB is the manager\'s to fix', () => {
    const rows = [...starters, p({ playerId: 'qb-1', position: 'QB', slotType: 'bench' }), p({ playerId: 'bn-1', position: 'WR', slotType: 'bench' })]
    const result = validateRedraftLineup({ sport: 'NFL', week: 4, players: rows, rosterConfig: config() })
    expect(result.ok).toBe(false)
    const byCode = new Map(result.issues.map((i) => [i.code, i]))
    expect(byCode.get('missing_required_position')).toMatchObject({ severity: 'error' })
    expect(byCode.get('missing_starter_slot')).toMatchObject({ severity: 'error', slotType: 'QB' })
  })

  it('still refuses a bench beyond the empty seats', () => {
    const rows = [...starters, ...['bn-1', 'bn-2', 'bn-3'].map((id) => p({ playerId: id, position: 'WR', slotType: 'bench' }))]
    const result = validateRedraftLineup({ sport: 'NFL', week: 4, players: rows, rosterConfig: config() })
    expect(result.ok).toBe(false)
    expect(result.issues.map((i) => i.code)).toContain('bench_slot_overflow')
  })
})
