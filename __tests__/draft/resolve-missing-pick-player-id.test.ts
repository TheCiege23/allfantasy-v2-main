/**
 * 🛑 A DRAFT PICK SAVED WITH NO PLAYER ID SCORES ZERO ALL SEASON.
 *
 * Seen in a live NFL draft, 2026-11-19: two autopicks (Kenneth Walker III at 16, Caleb Williams at 17)
 * carried a name, position and team but no id. At draft finish such a pick got an id made from its
 * name, which no stat row is filed under. The registry rows below are the shapes production held.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { pickRegistryId, resolveMissingNflPickPlayerId } from '@/lib/draft/resolveMissingPickPlayerId'

const row = (sleeperId: string | null, name: string, position: string | null, team: string | null) => ({ sleeperId, name, position, team })

describe('pickRegistryId', () => {
  it('the same player listed by three sources is one id', () => {
    const rows = [row('11560', 'Caleb Williams', 'QB', 'Chicago Bears'), row('11560', 'Caleb Williams', 'QB', 'Chicago Bears'), row('11560', 'Caleb Williams', 'QB', 'Chicago Bears')]
    expect(pickRegistryId({ playerName: 'Caleb Williams', position: 'QB' }, rows)).toBe('11560')
  })
  it('a suffix on either side still matches, and a retired namesake with no team loses to the active one', () => {
    const rows = [row('4634', 'Kenneth Walker', 'RB', ''), row('8151', 'Kenneth Walker III', 'RB', 'Kansas City Chiefs'), row('8151', 'Kenneth Walker', 'RB', 'Kansas City Chiefs')]
    expect(pickRegistryId({ playerName: 'Kenneth Walker III', position: 'RB' }, rows)).toBe('8151')
  })
  it('position separates namesakes', () => {
    const rows = [row('1', 'Josh Allen', 'QB', 'Buffalo Bills'), row('2', 'Josh Allen', 'LB', 'Jacksonville Jaguars')]
    expect(pickRegistryId({ playerName: 'Josh Allen', position: 'QB' }, rows)).toBe('1')
  })
  it('🛑 two active namesakes at one position resolve to nothing, never a guess', () => {
    const rows = [row('1', 'Mike Williams', 'WR', 'Team A'), row('2', 'Mike Williams', 'WR', 'Team B')]
    expect(pickRegistryId({ playerName: 'Mike Williams', position: 'WR' }, rows)).toBeNull()
  })
  it('a different name, or a row with no id, is never used', () => {
    expect(pickRegistryId({ playerName: 'Caleb Williams', position: 'QB' }, [row('9', 'Caleb Williamson', 'QB', 'X'), row(null, 'Caleb Williams', 'QB', 'X')])).toBeNull()
  })
})

describe('resolveMissingNflPickPlayerId', () => {
  const db = { sportsPlayer: { findMany: vi.fn(async () => [row('11560', 'Caleb Williams', 'QB', 'Chicago Bears')]) } }
  it('fills the id for an NFL pick that has none', async () => {
    expect(await resolveMissingNflPickPlayerId({ sport: 'NFL', playerName: 'Caleb Williams', position: 'QB' }, db)).toBe('11560')
  })
  it('leaves a pick that already has an id, a skipped pick, and every other sport alone', async () => {
    db.sportsPlayer.findMany.mockClear()
    expect(await resolveMissingNflPickPlayerId({ sport: 'NFL', playerName: 'Caleb Williams', position: 'QB', playerId: '11560' }, db)).toBeNull()
    expect(await resolveMissingNflPickPlayerId({ sport: 'NFL', playerName: '(Skipped)', position: 'SKIP' }, db)).toBeNull()
    expect(await resolveMissingNflPickPlayerId({ sport: 'NBA', playerName: 'Caleb Williams', position: 'G' }, db)).toBeNull()
    expect(db.sportsPlayer.findMany).not.toHaveBeenCalled()
  })
  it('a failed lookup resolves to nothing', async () => {
    expect(await resolveMissingNflPickPlayerId({ sport: 'NFL', playerName: 'Caleb Williams', position: 'QB' }, { sportsPlayer: { findMany: async () => { throw new Error('down') } } })).toBeNull()
  })
})
