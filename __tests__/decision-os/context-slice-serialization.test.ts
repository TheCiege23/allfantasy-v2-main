// @vitest-environment node
/**
 * Hub serialization, 2026-11-20: the matchup, the roster and the standings reach the prompt field by field
 * (lib/decision-os/grounding/contextSliceText.ts). Measured before this: the roster printed "starters: 10 items
 * (not itemised here)" — no player names — the standings "rows: 12 items", and the matchup was cut after 8 fields.
 */
import { describe, expect, it } from 'vitest'
import { serializeDecisionOsGroundingForPrompt } from '@/lib/decision-os/grounding/serialize'
import { renderMatchupSlice, renderRosterSlice, renderStandingsSlice } from '@/lib/decision-os/grounding/contextSliceText'

const p = (value: unknown) => ({ present: true, value, asOf: null, servedFrom: 'live', confidence: null, conclusive: { ok: true } })
const gone = { present: false, value: null, asOf: null, servedFrom: null, confidence: null, conclusive: { ok: true }, gap: { reason: 'not_requested', detail: '', remedy: '' } }

const player = (i: number, slot: string, name: string | null = `Runner ${i}`) => ({ playerId: `p${i}`, name, position: 'RB', team: 'KC', slot })
const MATCHUP = {
  leagueId: 'L', week: 14, yourTeamId: 't1', opponentTeamId: 't2', yourProjectedPoints: 118.4, opponentProjectedPoints: 121.9,
  status: 'scheduled', season: 2026, yourActualPoints: null, opponentActualPoints: null, opponentTeamName: 'Rival FC',
  playoffStartWeek: 15, isPlayoffWeek: false, weeksUntilPlayoffs: 1, projectedMargin: -3.5, projectedLeader: 'opponent', urgencyLevel: 'high',
}
const ROSTER = {
  leagueId: 'L', teamId: 't1',
  starters: Array.from({ length: 10 }, (_, i) => player(i, 'FLEX')),
  bench: [player(10, 'BN'), player(11, 'BN', null)],
  starterProjectedTotal: 118.4, weaknessSignals: ['shallow_depth:RB'], teamIdentityHint: 'unknown',
}
const STANDINGS = {
  leagueId: 'L',
  rows: Array.from({ length: 12 }, (_, i) => ({ teamId: `t${i}`, teamName: `Club ${i}`, rank: 12 - i, wins: i, losses: 11 - i, ties: 0, pointsFor: 1200 + i, pointsAgainst: 1300 })),
}

function packetWith(context: Record<string, unknown>) {
  const packet: Record<string, unknown> = {
    leagueId: 'L', userId: 'u', builtAt: new Date().toISOString(), gaps: [], meta: { durationMs: 1, sources: [], killedFeeds: [] },
    contextFacts: { matchup: gone, roster: gone, standings: gone, rankings: gone, leagueDifficulty: gone, importedHistory: gone, replayInsights: gone, devy: gone, leagueOffice: gone, ...context },
  }
  for (const k of ['importAssertions', 'leagueRules', 'marketValues', 'devyValues', 'projections', 'commissionerIntelligence', 'leagueIntelligence', 'portfolio', 'waiverDecision', 'commissionerHealthDecision', 'idpKickerValues', 'rosterProjections', 'rosterValueGrade']) packet[k] = gone
  return serializeDecisionOsGroundingForPrompt(packet as never)
}

describe('the roster', () => {
  it('names every starter and bench player, and counts an unnamed one rather than renaming him after his id', () => {
    const text = packetWith({ roster: p(ROSTER) })
    for (let i = 0; i <= 10; i++) expect(text).toContain(`Runner ${i} (RB, KC)`)
    expect(text).toContain('+1 unidentified')
    expect(text).not.toContain('p11')
    expect(text).not.toContain('not itemised')
    expect(text).toContain('Weak spots: shallow_depth:RB')
    // Documented as always "unknown" until its formula exists: not printed.
    expect(text).not.toContain('teamIdentityHint')
  })
})

describe('the standings', () => {
  it('prints the whole table in rank order', () => {
    const lines = renderStandingsSlice(STANDINGS)
    expect(lines).toHaveLength(12)
    expect(lines[0]).toBe('    1. Club 11 11-0 (PF 1211, PA 1300)')
    expect(lines[11]).toBe('    12. Club 0 0-11 (PF 1200, PA 1300)')
    expect(packetWith({ standings: p(STANDINGS) })).not.toContain('rows: 12 items')
  })
})

describe('the matchup', () => {
  it('keeps the playoff clock, the margin and who leads — the fields the 8-row cap used to drop', () => {
    const text = renderMatchupSlice(MATCHUP).join('\n')
    expect(text).toContain('Week 14, 2026 — scheduled')
    expect(text).toContain('Opponent: Rival FC')
    expect(text).toContain('Projected margin: -3.5 (they lead)')
    expect(text).toContain('Playoffs start week 15 — 1 week away.')
  })

  it('a missing projection is "not projected", never 0', () => {
    expect(renderMatchupSlice({ ...MATCHUP, yourProjectedPoints: null, projectedMargin: null }).join('\n')).toContain('you not projected')
  })
})

describe('the generic renderer', () => {
  it('names the fields it does not show instead of dropping them silently', () => {
    const wide = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`field${i}`, i]))
    const text = packetWith({ rankings: p(wide) })
    expect(text).toContain('field7: 7')
    expect(text).toContain('(+3 more fields not shown here: field8, field9, field10')
  })

  it('a roster player is named through `name` as well as `playerName`', () => {
    expect(renderRosterSlice(ROSTER).join('\n')).toContain('FLEX: Runner 0 (RB, KC)')
  })
})
