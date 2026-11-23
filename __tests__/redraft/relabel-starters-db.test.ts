/**
 * Starter labels written back to the season roster (lib/redraft/relabelStarters.ts) and by the native
 * lineup sync after a save (lib/roster-lineup-engine/redraftSlotSync.ts). A tiny in-memory table stands in
 * for `redraft_roster_players`, so what is asserted is the rows that end up stored.
 */
import { describe, expect, it } from 'vitest'
import { relabelRosterStarters, relabelSeasonStarters } from '@/lib/redraft/relabelStarters'
import { syncRedraftSlotTypesForLineup } from '@/lib/roster-lineup-engine/redraftSlotSync'

type Row = { id: string; rosterId: string; playerId: string; position: string; slotType: string; droppedAt: Date | null }

function fakeDb(rows: Row[]) {
  const match = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (k === 'id' && v && typeof v === 'object' && 'in' in (v as object)) return ((v as { in: string[] }).in).includes(r.id)
      return (r as unknown as Record<string, unknown>)[k] === v
    })
  return {
    rows,
    redraftRoster: { findMany: async () => [...new Set(rows.map((r) => r.rosterId))].map((id) => ({ id })) },
    redraftRosterPlayer: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => match(r, where)),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const hit = rows.filter((r) => match(r, where))
        hit.forEach((r) => Object.assign(r, data))
        return { count: hit.length }
      },
    },
  }
}

const SETTINGS = { starter_slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLX: 1, K: 1, DEF: 1 } }
const team = (): Row[] => [
  { id: '1', rosterId: 'R', playerId: 'qb', position: 'QB', slotType: 'QB', droppedAt: null },
  { id: '2', rosterId: 'R', playerId: 'rb1', position: 'RB', slotType: 'RB', droppedAt: null },
  { id: '3', rosterId: 'R', playerId: 'rb2', position: 'RB', slotType: 'RB', droppedAt: null },
  { id: '4', rosterId: 'R', playerId: 'rb3', position: 'RB', slotType: 'RB', droppedAt: null },
  { id: '5', rosterId: 'R', playerId: 'wr1', position: 'WR', slotType: 'WR', droppedAt: null },
  { id: '6', rosterId: 'R', playerId: 'wr2', position: 'WR', slotType: 'WR', droppedAt: null },
  { id: '7', rosterId: 'R', playerId: 'te', position: 'TE', slotType: 'TE', droppedAt: null },
  { id: '8', rosterId: 'R', playerId: 'bn', position: 'WR', slotType: 'bench', droppedAt: null },
]

describe('relabelRosterStarters', () => {
  it('stores the third RB under FLX and touches nobody else', async () => {
    const db = fakeDb(team())
    expect(await relabelRosterStarters(db as never, { redraftRosterId: 'R', sport: 'NFL', leagueSettings: SETTINGS })).toBe(1)
    expect(db.rows.filter((r) => r.slotType === 'FLX')).toHaveLength(1)
    expect(db.rows.filter((r) => r.slotType === 'RB')).toHaveLength(2)
    expect(db.rows.find((r) => r.playerId === 'bn')?.slotType).toBe('bench')
  })

  it('is idempotent: a second pass changes nothing', async () => {
    const db = fakeDb(team())
    await relabelRosterStarters(db as never, { redraftRosterId: 'R', sport: 'NFL', leagueSettings: SETTINGS })
    expect(await relabelRosterStarters(db as never, { redraftRosterId: 'R', sport: 'NFL', leagueSettings: SETTINGS })).toBe(0)
  })

  it('relabels every roster in a season', async () => {
    const db = fakeDb([...team(), ...team().map((r) => ({ ...r, id: `b${r.id}`, rosterId: 'S' }))])
    expect(await relabelSeasonStarters(db as never, { seasonId: 's', sport: 'NFL', leagueSettings: SETTINGS })).toEqual({ rosters: 2, relabelled: 2 })
  })
})

describe('the native lineup sync relabels after a save', () => {
  it('moves the bench WR in for an RB and leaves labels the layout accepts', async () => {
    const db = fakeDb(team())
    // The saved lineup: wr3 ("bn") in, rb3 out.
    const playerData = { lineup_sections: { starters: ['qb', 'rb1', 'rb2', 'bn', 'wr1', 'wr2', 'te'].map((id) => ({ id })), bench: [{ id: 'rb3' }] } }
    await syncRedraftSlotTypesForLineup(db as never, { redraftRosterId: 'R', playerData, sport: 'NFL', leagueSettings: SETTINGS })
    expect(db.rows.find((r) => r.playerId === 'rb3')?.slotType).toBe('bench')
    const labels = db.rows.filter((r) => r.slotType !== 'bench').map((r) => r.slotType).sort()
    expect(labels).toEqual(['FLX', 'QB', 'RB', 'RB', 'TE', 'WR', 'WR'])
  })

  it('[control] without sport and settings it only syncs who starts, as before', async () => {
    const db = fakeDb(team())
    const playerData = { lineup_sections: { starters: ['qb', 'rb1', 'rb2', 'rb3', 'wr1', 'wr2', 'te'].map((id) => ({ id })), bench: [{ id: 'bn' }] } }
    await syncRedraftSlotTypesForLineup(db as never, { redraftRosterId: 'R', playerData })
    expect(db.rows.filter((r) => r.slotType === 'RB')).toHaveLength(3)
  })
})
