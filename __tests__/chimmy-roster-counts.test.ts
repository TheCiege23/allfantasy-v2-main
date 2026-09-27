import { describe, expect, it } from 'vitest'
import { rosterCountEvidence } from '@/lib/chimmy/rosterCounts'

const ref = (id: string, position: string | null, name: string | null = id) => ({ playerId: id, position, name, team: null, injuryStatus: null })

describe('current roster count evidence', () => {
  it('counts the complete 25-player roster by primary position', () => {
    const roster = [['QB', 4], ['RB', 7], ['WR', 8], ['TE', 6]] as const
    const players = roster.flatMap(([p, n]) => Array.from({ length: n }, (_, i) => ref(`${p}${i}`, p)))
    expect(rosterCountEvidence(players)).toContain('25 distinct identified players')
    expect(rosterCountEvidence(players)).toContain('QB: 4; RB: 7; TE: 6; WR: 8')
  })
  it('deduplicates placement copies without dropping unnamed players or unknown positions', () => {
    const out = rosterCountEvidence([ref('1', 'TE'), ref('1', ' te '), ref('2', null, null), ref('3', 'WR', null)])
    expect(out).toContain('3 distinct identified players')
    expect(out).toContain('TE: 1; UNKNOWN: 1; WR: 1')
  })
  it('discloses conflicting positions and missing IDs instead of guessing identities', () => {
    const out = rosterCountEvidence([ref('1', 'TE'), ref('1', 'WR'), ref('', 'RB'), ref('0', null)])
    expect(out).toContain('1 distinct identified players')
    expect(out).toContain('UNKNOWN: 1')
    expect(out).toContain('1 row(s) lack a player ID')
    expect(out).toContain('1 zero-ID empty-slot marker(s) are excluded')
  })
})
