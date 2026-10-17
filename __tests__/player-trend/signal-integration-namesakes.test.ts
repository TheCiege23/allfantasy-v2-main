/**
 * 🛑 A TREND SIGNAL BY NAME WAS A SIGNAL FOR EVERY PLAYER WITH THAT NAME.
 *
 * `recordTrendSignalsByPlayerNames` (fed by `/api/ai/waiver`'s top adds) matched `Player` rows by
 * name and recorded a signal for EVERY hit, so one AI pick of "Justin Jefferson" pushed both the
 * Vikings receiver and the Browns linebacker up the trend feed. `PickSubmissionService` used
 * `findFirst` by name — whichever namesake came back. Rows here are production `Player` rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; name: string; position: string; team: string | null }>,
  recorded: vi.fn(async () => {}),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      findMany: vi.fn(async (args: { where: { OR: Array<{ name: { equals: string } }> } }) => {
        const want = new Set(args.where.OR.map((c) => c.name.equals.toLowerCase()))
        return h.rows.filter((r) => want.has(r.name.toLowerCase()))
      }),
    },
  },
}))
vi.mock('@/lib/player-trend/PlayerTrendUpdater', () => ({
  recordTrendSignalsAndUpdate: h.recorded,
  recordTrendSignal: vi.fn(async () => {}),
}))

import { recordTrendSignalsByPlayerNames, resolveTrendPlayerIds } from '@/lib/player-trend/signal-integration'

const JEFFERSON_WR = { id: 'nfl-justin-jefferson-28fd81ce', name: 'Justin Jefferson', position: 'WR', team: 'MIN' }
const JEFFERSON_LB = { id: 'nfl-justin-jefferson-a6b68cb2', name: 'Justin Jefferson', position: 'LB', team: 'CLE' }
const BTJ = { id: 'nfl-brian-thomas-2d55d847', name: 'Brian Thomas Jr.', position: 'WR', team: 'JAX' }

beforeEach(() => {
  h.rows = [JEFFERSON_LB, JEFFERSON_WR, BTJ]
  h.recorded.mockClear()
})

const recordedIds = () =>
  (h.recorded.mock.calls[0]?.[0] as Array<{ playerId: string }> | undefined)?.map((s) => s.playerId) ?? []

describe('🛑 recordTrendSignalsByPlayerNames binds each pick to ONE player', () => {
  it('an AI add of the WR records the WR only — never both Jeffersons', async () => {
    const n = await recordTrendSignalsByPlayerNames({
      players: [{ name: 'Justin Jefferson', position: 'WR', team: 'MIN' }],
      sport: 'NFL',
      signalType: 'ai_recommendation',
      value: 1,
    })
    expect(n).toBe(1)
    expect(recordedIds()).toEqual([JEFFERSON_WR.id])
  })

  it('a bare shared name records NOTHING', async () => {
    const n = await recordTrendSignalsByPlayerNames({
      players: ['Justin Jefferson'],
      sport: 'NFL',
      signalType: 'ai_recommendation',
    })
    expect(n).toBe(0)
    expect(h.recorded).not.toHaveBeenCalled()
  })

  it('[control] a unique name still records from the name alone', async () => {
    await recordTrendSignalsByPlayerNames({ players: ['Brian Thomas Jr.'], sport: 'NFL', signalType: 'ai_recommendation' })
    expect(recordedIds()).toEqual([BTJ.id])
  })
})

describe('🛑 resolveTrendPlayerIds (the draft-pick fallback)', () => {
  it('binds by position, and refuses a lone row on the other side of the ball', async () => {
    expect(await resolveTrendPlayerIds([{ name: 'Justin Jefferson', position: 'LB' }], 'NFL')).toEqual([JEFFERSON_LB.id])
    h.rows = [JEFFERSON_LB]
    expect(await resolveTrendPlayerIds([{ name: 'Justin Jefferson', position: 'WR', team: 'MIN' }], 'NFL')).toEqual([null])
  })

  it('normalises a spelled-out team to the canonical abbreviation', async () => {
    h.rows = [
      { id: 'mw-pit', name: 'Mike Williams', position: 'WR', team: 'PIT' },
      { id: 'mw-nyj', name: 'Mike Williams', position: 'WR', team: 'NYJ' },
    ]
    expect(await resolveTrendPlayerIds([{ name: 'Mike Williams', position: 'WR', team: 'Pittsburgh Steelers' }], 'NFL')).toEqual(['mw-pit'])
  })
})
