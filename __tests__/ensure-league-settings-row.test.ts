/**
 * A league built outside the create form (a tournament's own leagues) has no draft-settings row.
 * Its first row takes the league's own round count, not the column default of 15, and an existing
 * row is never touched.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  row: null as null | { id: string },
  created: [] as Array<Record<string, unknown>>,
  rounds: 13 as unknown,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueSettings: {
      findUnique: vi.fn(async () => db.row),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.created.push(data)
        return data
      }),
    },
  },
}))
vi.mock('@/lib/draft-defaults/DraftRoomConfigResolver', () => ({
  getDraftConfigForLeague: vi.fn(async () => {
    if (db.rounds === 'throw') throw new Error('no config')
    return { rounds: db.rounds }
  }),
}))

import { ensureLeagueSettingsRow } from '@/lib/draft-defaults/ensureLeagueSettingsRow'

beforeEach(() => {
  db.row = null
  db.created.length = 0
  db.rounds = 13
})

describe('ensureLeagueSettingsRow', () => {
  it('creates the first row with the league round count', async () => {
    await ensureLeagueSettingsRow('L1')
    expect(db.created).toEqual([{ leagueId: 'L1', rounds: 13 }])
  })

  it('lets the values being saved win over the resolved round count', async () => {
    await ensureLeagueSettingsRow('L1', { rounds: 20, aiAutoPick: true })
    expect(db.created).toEqual([{ leagueId: 'L1', rounds: 20, aiAutoPick: true }])
  })

  it('leaves an existing row alone', async () => {
    db.row = { id: 'S1' }
    await ensureLeagueSettingsRow('L1', { rounds: 20 })
    expect(db.created).toEqual([])
  })

  it.each([[0], [51], [12.5], ['throw']])(
    'falls back to the column default when the round count is %s',
    async (rounds) => {
      db.rounds = rounds
      await ensureLeagueSettingsRow('L1')
      expect(db.created).toEqual([{ leagueId: 'L1' }])
    },
  )
})
