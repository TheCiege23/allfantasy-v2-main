// @vitest-environment node
/**
 * PATCH /api/tournament/[id]/settings/update writes the LegacyTournament.settings keys the
 * tournament-mode engine READS.
 *
 * 🛑 IT USED TO WRITE `bubbleEnabled` AND `advancementPerLeague`, WHICH NOTHING READS. The engine
 * reads `bubbleWeekEnabled` (TournamentStandingsService, TournamentProgressionService, the bracket
 * route) and `eliminationAdvancementPerLeague` (the advance route). Every save of those two fields
 * returned success and changed nothing, so these tests assert the READ key, not the response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tournament: null as null | { creatorId: string; name: string; status: string; settings: Record<string, unknown>; hubSettings: Record<string, unknown> },
  updates: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    legacyTournament: {
      findUnique: vi.fn(async () => (h.tournament ? JSON.parse(JSON.stringify(h.tournament)) : null)),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.updates.push(data)
        Object.assign(h.tournament!, data)
      }),
    },
  },
}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u-creator' } })) }))
vi.mock('@/lib/tournament-mode/TournamentAuditService', () => ({ logTournamentAudit: vi.fn(async () => undefined) }))

import { PATCH } from '@/app/api/tournament/[tournamentId]/settings/update/route'

const params = { params: Promise.resolve({ tournamentId: 'LT1' }) }
const patch = (body: unknown) =>
  PATCH(new Request('http://localhost/api/tournament/LT1/settings/update', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never, params)

describe('legacy tournament settings/update', () => {
  beforeEach(() => {
    h.updates = []
    h.tournament = {
      creatorId: 'u-creator',
      name: 'Black vs Gold',
      status: 'qualification',
      settings: { draftType: 'snake', bubbleWeekEnabled: false, eliminationAdvancementPerLeague: 6 },
      hubSettings: {},
    }
  })

  it('the bubble toggle writes bubbleWeekEnabled, the key the engine reads', async () => {
    const res = await patch({ bubbleWeekEnabled: true })
    expect(res.status).toBe(200)
    expect(h.tournament!.settings.bubbleWeekEnabled).toBe(true)
    expect(h.tournament!.settings).not.toHaveProperty('bubbleEnabled')
  })

  it('advancers per league writes eliminationAdvancementPerLeague, capped at the advance route’s 11', async () => {
    await patch({ eliminationAdvancementPerLeague: 4 })
    expect(h.tournament!.settings.eliminationAdvancementPerLeague).toBe(4)
    await patch({ eliminationAdvancementPerLeague: 20 })
    expect(h.tournament!.settings.eliminationAdvancementPerLeague).toBe(11)
    expect(h.tournament!.settings).not.toHaveProperty('advancementPerLeague')
  })

  it('an older client sending the old names still reaches the keys the engine reads', async () => {
    await patch({ bubbleEnabled: true, advancementPerLeague: 3 })
    expect(h.tournament!.settings).toMatchObject({ bubbleWeekEnabled: true, eliminationAdvancementPerLeague: 3 })
    expect(h.tournament!.settings).not.toHaveProperty('bubbleEnabled')
    expect(h.tournament!.settings).not.toHaveProperty('advancementPerLeague')
  })

  it('refuses a bubble size or scoring mode instead of storing a value nothing reads', async () => {
    expect((await patch({ bubbleSize: 8 })).status).toBe(400)
    expect((await patch({ bubbleScoringMode: 'cumulative_points' })).status).toBe(400)
    expect(h.updates).toEqual([])
  })

  it('still freezes the bubble once elimination has started', async () => {
    h.tournament!.status = 'elimination'
    expect((await patch({ bubbleWeekEnabled: true })).status).toBe(400)
    expect(h.tournament!.settings.bubbleWeekEnabled).toBe(false)
  })
})
