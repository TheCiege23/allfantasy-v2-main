/**
 * scripts/ingest-nflverse-stats.ts — a synthetic `NFL-<season>-W<week>` row and a real-id row for the
 * same player-week must never both exist, or the scorer counts the week twice (neither carries
 * `providerGameId`, so `statRowDedupeKey` cannot tell them apart). Fake client only; no database.
 */
import { describe, expect, it } from 'vitest'
import {
  isSyntheticNflverseGameId,
  syntheticNflverseGameId,
  writeNflverseGameRow,
  type NflverseGameRow,
  type NflverseStatDb,
} from '@/scripts/ingest-nflverse-stats-helpers'
import { statRowDedupeKey } from '@/lib/multi-sport/MultiSportMatchupScoringService'

type Row = {
  id: string
  playerId: string
  sportType: string
  gameId: string
  season: number
  weekOrRound: number
  source: string | null
  normalizedStatMap: Record<string, number>
  providerGameId: string | null
}

function fakeDb(seed: Row[] = []) {
  const rows: Row[] = seed.map((r) => ({ ...r }))
  let next = rows.length + 1
  const matches = (r: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v)
  const db: NflverseStatDb = {
    playerGameStat: {
      async upsert({ where, update, create }) {
        const key = where.playerId_sportType_gameId as { playerId: string; sportType: string; gameId: string }
        const hit = rows.find((r) => r.playerId === key.playerId && r.sportType === key.sportType && r.gameId === key.gameId)
        if (hit) Object.assign(hit, update)
        else rows.push({ id: `r${next++}`, providerGameId: null, ...(create as unknown as Omit<Row, 'id' | 'providerGameId'>) })
        return null
      },
      async deleteMany({ where }) {
        const before = rows.length
        for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) rows.splice(i, 1)
        return { count: before - rows.length }
      },
      async findMany({ where }) {
        return rows.filter((r) => matches(r, where)).map((r) => ({ id: r.id, gameId: r.gameId }))
      },
      async update({ where, data }) {
        const hit = rows.find((r) => r.id === where.id)
        if (!hit) throw new Error('not found')
        Object.assign(hit, data)
        return null
      },
    },
  }
  return { db, rows }
}

const base = (gameId: string, stats: Record<string, number>): NflverseGameRow => ({
  playerId: 'p1',
  gameId,
  season: 2024,
  week: 3,
  opponent: 'BUF',
  team: 'MIA',
  stats,
})

const seeded = (gameId: string, extra: Partial<Row> = {}): Row => ({
  id: `seed-${gameId}`,
  playerId: 'p1',
  sportType: 'NFL',
  gameId,
  season: 2024,
  weekOrRound: 3,
  source: 'nflverse',
  normalizedStatMap: { rushing_yards: 40 },
  providerGameId: null,
  ...extra,
})

/** Distinct games the scorer would count for p1 in week 3 after its own dedupe guard. */
const countedGames = (rows: Row[]) =>
  new Set(rows.filter((r) => r.playerId === 'p1' && r.weekOrRound === 3).map((r) => statRowDedupeKey(r))).size

describe('nflverse synthetic game ids', () => {
  it('names the synthetic id the way the script always has', () => {
    expect(syntheticNflverseGameId(2024, 3)).toBe('NFL-2024-W03')
    expect(isSyntheticNflverseGameId('NFL-2024-W03')).toBe(true)
    expect(isSyntheticNflverseGameId('2024_03_MIA_BUF')).toBe(false)
  })

  it('a real-id run removes the synthetic row an earlier run left for that player-week', async () => {
    const { db, rows } = fakeDb([seeded('NFL-2024-W03')])
    const outcome = await writeNflverseGameRow(db, base('2024_03_MIA_BUF', { rushing_yards: 42 }))
    expect(outcome).toBe('replaced_synthetic')
    expect(rows.map((r) => r.gameId)).toEqual(['2024_03_MIA_BUF'])
    expect(countedGames(rows)).toBe(1)
  })

  it('a synthetic-id run after a real-id run updates the real row instead of adding a second', async () => {
    const { db, rows } = fakeDb([seeded('2024_03_MIA_BUF')])
    const outcome = await writeNflverseGameRow(db, base('NFL-2024-W03', { rushing_yards: 55 }))
    expect(outcome).toBe('merged_into_real')
    expect(rows).toHaveLength(1)
    expect(rows[0].gameId).toBe('2024_03_MIA_BUF')
    expect(rows[0].normalizedStatMap).toEqual({ rushing_yards: 55 })
    expect(countedGames(rows)).toBe(1)
  })

  it('leaves another source’s rows and other weeks alone', async () => {
    const { db, rows } = fakeDb([
      seeded('NFL-2024-W03', { id: 'other-src', source: 'sleeper' }),
      seeded('NFL-2024-W04', { id: 'w4', weekOrRound: 4 }),
    ])
    await writeNflverseGameRow(db, base('2024_03_MIA_BUF', { rushing_yards: 42 }))
    expect(rows.map((r) => r.id).sort()).toEqual(['other-src', 'r3', 'w4'].sort())
  })

  it('does not guess between two real-id rows for one player-week', async () => {
    const { db, rows } = fakeDb([seeded('2024_03_MIA_BUF'), seeded('2024_03_MIA_BUF_dup')])
    expect(await writeNflverseGameRow(db, base('NFL-2024-W03', { rushing_yards: 1 }))).toBe('skipped_ambiguous')
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.normalizedStatMap.rushing_yards === 40)).toBe(true)
  })

  it('a first run on either id writes one row', async () => {
    for (const id of ['NFL-2024-W03', '2024_03_MIA_BUF']) {
      const { db, rows } = fakeDb()
      expect(await writeNflverseGameRow(db, base(id, { rushing_yards: 7 }))).toBe('written')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ gameId: id, source: 'nflverse', season: 2024, weekOrRound: 3, sportType: 'NFL' })
    }
  })
})
