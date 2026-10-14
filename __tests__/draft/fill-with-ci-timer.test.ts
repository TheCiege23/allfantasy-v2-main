/**
 * "Fill with CI" (POST /api/leagues/[leagueId]/fill-empty-slots) sets a 30s pick clock. It must
 * write that clock to EVERY store that carries one — including `League.settings.draft_timer_seconds`
 * (via updateDraftConfigForLeague), which is what the commissioner Draft tab reads. Before, only the
 * draft session and LeagueSettings.pickTimerPreset were written, so the tab kept showing the old
 * clock and its Save wrote it back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  updateDraftConfigForLeague: vi.fn(),
  draftSessionUpdate: vi.fn(),
  leagueSettingsUpsert: vi.fn(),
  existingTeams: [{ id: 't1' }] as Array<{ id: string }>,
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/commissioner/permissions', () => ({ assertCommissioner: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/tournament/seasonDraftMutationGate', () => ({ isSeasonTournamentDraft: vi.fn().mockResolvedValue(false), SEASON_DRAFT_MUTATION_BLOCKED: 'blocked' }))
vi.mock('@/lib/draft-strategies/strategyDefinitions', () => ({ getRandomStrategy: () => ({ id: 's', name: 'S', archetypeId: 'a' }) }))
vi.mock('@/lib/draft-strategies/strategyTracker', () => ({ createStrategyLog: vi.fn(), initializeDraftStrategyTracking: vi.fn() }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  getOrCreateDraftSession: vi.fn().mockResolvedValue({ session: { id: 'ds1' } }),
  buildSessionSnapshot: vi.fn(),
}))
vi.mock('@/server/services/leagueLifecycleService', () => ({ transitionLeagueState: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/draft-defaults/DraftVariantSettingsHub', () => ({
  updateDraftConfigForLeague: (...a: unknown[]) => m.updateDraftConfigForLeague(...a),
}))
vi.mock('@/lib/prisma', () => {
  let n = 0
  return {
    prisma: {
      league: { findUnique: vi.fn().mockResolvedValue({ leagueSize: 3 }) },
      leagueTeam: {
        findMany: vi.fn(async () => (m.existingTeams.length >= 3
          ? m.existingTeams.map((t) => ({ ...t, externalId: `r-${t.id}`, teamName: t.id, ownerName: t.id, avatarUrl: null }))
          : m.existingTeams)),
        create: vi.fn(async ({ data }: any) => { const row = { id: `new-${++n}`, ...data }; m.existingTeams.push({ id: row.id }); return row }),
      },
      roster: { create: vi.fn(async () => ({ id: `roster-${++n}` })) },
      draftSession: { update: (...a: unknown[]) => m.draftSessionUpdate(...a) },
      leagueSettings: { upsert: (...a: unknown[]) => m.leagueSettingsUpsert(...a) },
    },
  }
})

import { POST } from '@/app/api/leagues/[leagueId]/fill-empty-slots/handler'
import { FILL_WITH_CI_PICK_TIMER_SECONDS } from '@/lib/draft/draftSettingsPolicy'

describe('Fill with CI — one pick clock everywhere', () => {
  beforeEach(() => {
    m.existingTeams = [{ id: 't1' }]
    m.updateDraftConfigForLeague.mockReset().mockResolvedValue(undefined)
    m.draftSessionUpdate.mockReset().mockResolvedValue({})
    m.leagueSettingsUpsert.mockReset().mockResolvedValue({})
  })

  it('writes the same 30s clock to the session, LeagueSettings and the Draft tab’s config, and returns it', async () => {
    const res = await POST(new Request('http://x/api/leagues/l1/fill-empty-slots', { method: 'POST' }) as any, {
      params: Promise.resolve({ leagueId: 'l1' }),
    })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(FILL_WITH_CI_PICK_TIMER_SECONDS).toBe(30)
    expect(m.draftSessionUpdate.mock.calls[0]![0].data.timerSeconds).toBe(30)
    expect(m.leagueSettingsUpsert.mock.calls[0]![0].update.pickTimerPreset).toBe('30s')
    expect(m.updateDraftConfigForLeague).toHaveBeenCalledWith('l1', { timer_seconds: 30 })
    expect(body).toMatchObject({ ok: true, teamsCreated: 2, pickTimerSeconds: 30, cpuAutoPick: true })
    expect(body.message).not.toMatch(/\bAI\b/)
  })
})
