/**
 * The rulebook's vote row reads when Tribal votes are REALLY due: the settings screen's vote day and
 * time (League.settings tribalCouncilDay / tribalCouncilTime, Eastern) — the values the council
 * scheduler resolves with nextTorchCeremonyDeadline — not the bootstrap-only voteDeadline* columns.
 * Regression: edit through the settings screen, then read the rulebook value.
 * Also: the 'rotate' island scene goes through the same settings-screen POST.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SurvivorSettingsForm } from '@/lib/survivor/survivorSettingsScreen'

const m = vi.hoisted(() => ({
  access: { isLeagueMember: true, decisions: { canUpdateSettings: true } } as Record<string, unknown> | null,
  settings: {} as Record<string, unknown>,
  upsertConfig: vi.fn(),
  tx: { league: { findUnique: vi.fn(), update: vi.fn() }, survivorCommissionerAction: { create: vi.fn() } },
  db: { league: { findUnique: vi.fn() }, survivorTribeMember: { count: vi.fn() }, $transaction: vi.fn() },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'commish' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/survivorAccessControl', () => ({ resolveSurvivorAccessContext: vi.fn(async () => m.access) }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ upsertSurvivorConfig: m.upsertConfig }))
vi.mock('@/lib/survivor/survivorIdolConfigService', () => ({
  isSurvivorDraftStarted: vi.fn(async () => true),
  getSurvivorIdolSetupView: vi.fn(async () => ({ config: { mode: 'random', count: 7, hideFromCommish: true, pickedTypeIds: [], pointSurgePct: 10, tributePct: 5 }, saved: true })),
  saveSurvivorIdolConfig: vi.fn(async () => ({ ok: true, config: {} })),
}))

import { GET, POST } from '@/server/api-route-modules/league-survivor/settings-screen/route'
import { nextTorchCeremonyDeadline, tribalVotesDueFromSettings } from '@/lib/survivor/survivorCeremonySchedule'
import { nextTribalVotesDueAt, rulebook, voteRuleWhen } from '@/lib/core-app/survivorRulebook'
import { resolveSurvivorIslandScene, rotatingIslandScene, SURVIVOR_ISLAND_SCENES } from '@/lib/survivor/survivorSettingsScreen'
import { ISLAND_SCENE_CHOICES } from '@/lib/core-app/survivorIslandSettings'

const req = (body: unknown) => new Request('http://test/api', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }) as never
const params = { params: Promise.resolve({ leagueId: 'L1' }) }
const current = async () => (await (await GET(req({}), params)).json()).form as SurvivorSettingsForm

beforeEach(() => {
  m.settings = { defaultTeamCount: 12, minTeamCount: 12, maxTeamCount: 12, tribeCount: 2, tribeAssignmentMode: 'random', mergeTriggerType: 'week', mergeWeek: 8,
    exileIslandEnabled: true, exileReturnTokens: 3, exileBossMode: 'median', finalistCount: 3, tribalCouncilDay: 'Tuesday', tribalCouncilTime: '20:00' }
  m.upsertConfig.mockReset()
  m.tx.league.findUnique.mockReset().mockImplementation(async () => ({ settings: m.settings }))
  m.tx.league.update.mockReset().mockImplementation(async (args: { data: { settings: Record<string, unknown> } }) => { m.settings = args.data.settings })
  m.tx.survivorCommissionerAction.create.mockReset()
  m.db.league.findUnique.mockReset().mockImplementation(async () => ({ name: 'Blah Survivor', sport: 'NFL', settings: m.settings, survivorSwapWeek: 5, survivorFinal3: true }))
  m.db.survivorTribeMember.count.mockReset().mockResolvedValue(0)
  m.db.$transaction.mockReset().mockImplementation(async (fn: (tx: typeof m.tx) => unknown) => fn(m.tx))
})

// A stale bootstrap column pair: Tuesday 15:00 UTC. Every edit below leaves it untouched.
const staleColumns = { voteDeadlineDayOfWeek: 2, voteDeadlineTimeUtc: '15:00', selfVoteDisallowed: true }

describe('rulebook vote row: one source of truth with the council scheduler', () => {
  it('after a settings-screen edit, the rulebook shows the NEW vote day and time', async () => {
    const before = await current()
    const res = await POST(req({ form: { ...before, voteDay: 'Thursday', voteTime: '21:30' } }), params)
    expect(res.status).toBe(200)
    // What the summary / dashboard send, read from the settings the edit just wrote.
    const config = { ...staleColumns, tribalVotesDue: tribalVotesDueFromSettings(m.settings) }
    const vote = rulebook(config).find((r) => r.id === 'vote')
    expect(vote).toEqual({ id: 'vote', day: 4, timeUtc: null, timeEt: '21:30', hoursBefore: 0, selfVote: false })
    // And the instant agrees with the scheduler's own resolution of the next Torch Ceremony.
    const now = new Date('2026-11-02T15:00:00Z') // a Monday
    expect(nextTribalVotesDueAt(vote!.day, '21:30', 0, now)?.toISOString()).toBe(nextTorchCeremonyDeadline(now, m.settings).toISOString())
    process.env.TZ = 'UTC'
    expect(voteRuleWhen(vote as Extract<typeof vote, { id: 'vote' }>, 'en-US', now)).toMatch(/^Friday/) // Thu 21:30 ET is Fri 02:30 UTC
  })

  it('follows DST the way the scheduler does, and moves earlier with "ballots due N hours before"', () => {
    const summer = new Date('2026-07-06T12:00:00Z') // Monday, EDT
    const settings = { tribalCouncilDay: 'Tuesday', tribalCouncilTime: '20:00', votesDueHoursBeforeCeremony: 3 }
    const due = tribalVotesDueFromSettings(settings)
    expect(due).toEqual({ day: 'Tuesday', timeEt: '20:00', hoursBefore: 3 })
    const ceremony = nextTorchCeremonyDeadline(summer, settings)
    expect(nextTribalVotesDueAt(2, '20:00', 3, summer)?.getTime()).toBe(ceremony.getTime() - 3 * 3_600_000)
    expect(ceremony.toISOString()).toBe('2026-07-08T00:00:00.000Z')
  })

  it('without the settings value an older server still shows the legacy columns', () => {
    expect(rulebook(staleColumns).find((r) => r.id === 'vote')).toEqual({ id: 'vote', day: 2, timeUtc: '15:00', selfVote: false })
  })
})

describe("island scene 'rotate': a new scene every season", () => {
  it('is deterministic per league and season, and consecutive seasons always differ', () => {
    expect(rotatingIslandScene('league-a', 2026)).toBe(rotatingIslandScene('league-a', '2026'))
    for (const id of ['league-a', 'league-b', 'cuid123xyz']) {
      for (let year = 2024; year < 2034; year++) expect(rotatingIslandScene(id, year)).not.toBe(rotatingIslandScene(id, year + 1))
    }
    expect(SURVIVOR_ISLAND_SCENES).toContain(rotatingIslandScene('league-a', null))
  })

  it("resolves only 'rotate'; 'auto' and a pinned scene are unchanged", () => {
    expect(resolveSurvivorIslandScene('rotate', 'league-a', 2026)).toBe(rotatingIslandScene('league-a', 2026))
    expect(resolveSurvivorIslandScene('auto', 'league-a', 2026)).toBe('auto')
    expect(resolveSurvivorIslandScene('volcano', 'league-a', 2026)).toBe('volcano')
  })

  it('is offered in the picker, saved by the settings screen, and the default stays auto', async () => {
    expect(ISLAND_SCENE_CHOICES.slice(0, 2)).toEqual(['auto', 'rotate'])
    expect((await current()).islandScene).toBe('auto')
    const res = await POST(req({ form: { ...(await current()), islandScene: 'rotate' } }), params)
    expect(res.status).toBe(200)
    expect(m.settings.survivorIslandScene).toBe('rotate')
    expect((await current()).islandScene).toBe('rotate')
  })
})
