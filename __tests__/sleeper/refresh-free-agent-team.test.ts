// @vitest-environment node
/**
 * 🛑 A released player's Sleeper row kept his old club forever.
 *
 * The update path wrote `teamDisplayNameForSport(sport, p.team) ?? undefined`. Sleeper reports a
 * free agent as `team: null`, the helper maps that to null, and `?? undefined` told Prisma to skip
 * the column — so the authoritative `source='sleeper'` row never lost the team. The create path
 * already wrote `?? null`. An UNKNOWN non-empty code must still never wipe a team.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  feed: {} as Record<string, Record<string, unknown>>,
  rows: [] as Row[],
  updates: [] as Array<{ where: Row; data: Row }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/sleeper-client', () => ({ getPlayersBySport: vi.fn(async () => h.feed) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: vi.fn(async () => h.rows),
      update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        h.updates.push({ where, data })
        return {}
      }),
      create: vi.fn(async () => ({})),
    },
  },
}))

import { refreshSleeperPlayerRows } from '@/lib/sleeper/refreshSleeperPlayerRows'

beforeEach(() => {
  h.feed = {}
  h.rows = []
  h.updates = []
})

async function teamWrittenFor(feedTeam: unknown, { omitKey = false } = {}) {
  const player: Record<string, unknown> = { player_id: '1', full_name: 'Some Player', position: 'WR' }
  if (!omitKey) player.team = feedTeam
  h.feed = { '1': player }
  h.rows = [{ id: 'sp-1', sleeperId: '1' }]
  await refreshSleeperPlayerRows({ sport: 'NFL' })
  expect(h.updates).toHaveLength(1)
  return h.updates[0].data
}

describe('refreshSleeperPlayerRows — team on the update path', () => {
  it('🛑 a free agent (team: null) clears the stored team — null, not undefined', async () => {
    const data = await teamWrittenFor(null)
    expect('team' in data).toBe(true)
    expect(data.team).toBeNull()
  })

  it('🛑 an empty or whitespace team is a free agent too', async () => {
    expect((await teamWrittenFor('')).team).toBeNull()
    h.updates = []
    expect((await teamWrittenFor('   ')).team).toBeNull()
  })

  it('a known code still maps to the display name', async () => {
    expect((await teamWrittenFor('DET')).team).toBe('Detroit Lions')
  })

  it('an unknown non-empty code is written through as given, never wiped', async () => {
    expect((await teamWrittenFor('ARZ')).team).toBe('ARZ')
  })

  it('a feed row with no team key at all leaves the column alone', async () => {
    expect((await teamWrittenFor(undefined, { omitKey: true })).team).toBeUndefined()
  })
})
