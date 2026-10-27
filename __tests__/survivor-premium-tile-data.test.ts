// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  role: vi.fn(),
  snapshot: vi.fn(),
  plan: vi.fn(),
  week: vi.fn(),
  prisma: {
    league: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorTribe: { findMany: vi.fn() },
    survivorPlayer: { findMany: vi.fn(), findUnique: vi.fn() },
    survivorTribalCouncil: { findMany: vi.fn() },
    survivorWeeklyScore: { findMany: vi.fn() },
    survivorChatChannel: { findFirst: vi.fn() },
    survivorChatMessage: { findMany: vi.fn() },
    survivorChallenge: { findMany: vi.fn() },
    survivorChallengeSubmission: { findMany: vi.fn() },
    survivorLeagueConfig: { findUnique: vi.fn() },
    integrityFlag: { findMany: vi.fn() },
    survivorAuditEntry: { findMany: vi.fn(), count: vi.fn() },
    survivorVote: { count: vi.fn() },
    survivorCommissionerAction: { findMany: vi.fn() },
  },
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/survivor/survivorAccessControl', () => ({ resolveSurvivorAccessContext: m.access }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: m.role }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({ EntitlementResolver: class { resolveSnapshot = m.snapshot } }))
vi.mock('@/lib/tournament/resolve-af-plan-from-subscription', async (importOriginal) => ({ ...(await importOriginal<object>()), resolveAfPlanFromEntitlement: m.plan }))
vi.mock('@/lib/survivor/SurvivorTimelineResolver', () => ({ resolveSurvivorCurrentWeek: m.week }))
vi.mock('@/lib/survivor/survivorWeeklyCall', () => ({ WEEKLY_CALL_TYPE: 'weekly_call' }))

import { loadSurvivorPremiumIndex, loadSurvivorPremiumTile } from '@/lib/survivor/premium/survivorPremiumTileData'
import { SURVIVOR_DEFAULT_FOUNDATION_SETTINGS } from '@/lib/survivor/survivorSettings'

const NOW = new Date('2026-10-22T12:00:00Z')
const readSequence = (names: string[]) => names.map((targetName, i) => ({ order: i + 1, targetName, status: 'counts', isExtraVote: false }))

beforeEach(() => {
  vi.clearAllMocks()
  m.access.mockResolvedValue({ isLeagueMember: true, settings: { ...SURVIVOR_DEFAULT_FOUNDATION_SETTINGS }, canAccessTribeChat: true, rosterId: 'r-bo' })
  m.role.mockResolvedValue('member')
  m.snapshot.mockResolvedValue({ plans: ['pro'], status: 'active' })
  m.plan.mockReturnValue('af_pro')
  m.week.mockResolvedValue(5)
  m.prisma.league.findUnique.mockResolvedValue({ settings: {}, survivorRevealMode: 'all_at_once' })
  m.prisma.survivorGameState.findUnique.mockResolvedValue({ mergeTriggeredAt: null })
  m.prisma.survivorTribe.findMany.mockResolvedValue([{ id: 't1', name: 'Fire', isMerged: false }])
  m.prisma.survivorPlayer.findMany.mockResolvedValue([
    { userId: 'u-bo', displayName: 'Bo', tribeId: 't1', playerState: 'active', isJuryMember: false },
    { userId: 'u-cy', displayName: 'Cy', tribeId: 't1', playerState: 'active', isJuryMember: false },
    // Voted out at week 5, whose read has not started: still looks in the game.
    { userId: 'u-ed', displayName: 'Ed', tribeId: 't1', playerState: 'exile', isJuryMember: false },
  ])
  const council = { status: 'closed', closedAt: NOW, voteDeadlineAt: NOW, attendingTribeId: 't1', isTie: false, tiePhase: null, revealStep: 0 }
  m.prisma.survivorTribalCouncil.findMany.mockResolvedValue([
    { ...council, week: 4, councilNumber: 1, eliminatedUserId: 'u-x', eliminatedName: 'X', isRevealed: true, revealStartsAt: new Date('2026-10-15T00:00:00Z'), revealSequence: readSequence(['Cy', 'X', 'X']) },
    { ...council, week: 5, councilNumber: 1, eliminatedUserId: 'u-ed', eliminatedName: 'Ed', isRevealed: false, revealStartsAt: null, revealSequence: readSequence(['Ed', 'Ed', 'Bo']) },
  ])
  m.prisma.survivorWeeklyScore.findMany.mockResolvedValue([])
})

describe('loadSurvivorPremiumTile', () => {
  it('refuses a locked tile before reading any league data', async () => {
    m.plan.mockReturnValue(null)
    const result = await loadSurvivorPremiumTile({ leagueId: 'lg', userId: 'u-bo', email: null, tileId: 'threat_map', now: NOW })
    expect(result).toEqual({ ok: false, status: 403, access: { ok: false, reason: 'plan_required', requiredPlan: 'af_pro' }, error: 'Upgrade to open this tile.' })
    expect(m.prisma.league.findUnique).not.toHaveBeenCalled()
    expect(m.prisma.survivorPlayer.findMany).not.toHaveBeenCalled()
    expect(m.prisma.survivorTribalCouncil.findMany).not.toHaveBeenCalled()
  })

  it('refuses an unbuilt tile even on the top plan, and a non-member gets a 404', async () => {
    m.plan.mockReturnValue('af_supreme')
    m.role.mockResolvedValue('commissioner')
    expect(await loadSurvivorPremiumTile({ leagueId: 'lg', userId: 'u-bo', email: null, tileId: 'story_mode_controls', now: NOW })).toMatchObject({ ok: false, status: 403, access: { reason: 'coming_next' } })
    m.access.mockResolvedValue({ isLeagueMember: false })
    expect(await loadSurvivorPremiumTile({ leagueId: 'lg', userId: 'stranger', email: null, tileId: 'threat_map', now: NOW })).toMatchObject({ ok: false, status: 404 })
    expect(m.prisma.survivorPlayer.findMany).not.toHaveBeenCalled()
  })

  it('threat map: votes count only at completed reads, and an unread elimination is still in the game', async () => {
    const result = await loadSurvivorPremiumTile({ leagueId: 'lg', userId: 'u-bo', email: null, tileId: 'threat_map', now: NOW })
    expect(result.ok).toBe(true)
    if (!result.ok || result.payload.tileId !== 'threat_map') return
    expect(result.payload.data.rows.map(r => [r.name, r.votesAgainst])).toEqual([['Bo', 0], ['Cy', 1], ['Ed', 0]])
    expect(result.payload.data.lastRead?.week).toBe(4)
    // The council query never asks for ballots.
    const select = m.prisma.survivorTribalCouncil.findMany.mock.calls[0][0].select
    expect(select.votes).toBeUndefined()
  })

  it('social pulse reads only the viewer’s own huddle, counts only, without hosts or system posts', async () => {
    m.prisma.survivorChatChannel.findFirst.mockResolvedValue({ id: 'ch-1', name: 'Fire huddle', memberUserIds: ['u-bo', 'u-cy'] })
    m.prisma.survivorChatMessage.findMany.mockResolvedValue([{ senderUserId: 'u-cy', createdAt: NOW }])
    const result = await loadSurvivorPremiumTile({ leagueId: 'lg', userId: 'u-bo', email: null, tileId: 'social_pulse', now: NOW })
    expect(m.prisma.survivorChatChannel.findFirst.mock.calls[0][0].where).toMatchObject({ channelType: 'tribe', tribeId: 't1', memberUserIds: { has: 'u-bo' } })
    expect(m.prisma.survivorChatMessage.findMany.mock.calls[0][0]).toMatchObject({ where: { channelId: 'ch-1', isSystemMessage: false, senderIsHost: false, isDeleted: false }, select: { senderUserId: true, createdAt: true } })
    expect(result).toMatchObject({ ok: true, payload: { tileId: 'social_pulse', data: { available: true, totalMessages: 1 } } })
  })

  it('exile status never reads another manager’s balance', async () => {
    m.access.mockResolvedValue({ isLeagueMember: true, settings: { ...SURVIVOR_DEFAULT_FOUNDATION_SETTINGS, exileIslandEnabled: true, eliminationOutcome: 'exile_island', exileReturnWeek: 9, exileReturnTokens: 4 }, canAccessTribeChat: true, rosterId: 'r-bo' })
    const result = await loadSurvivorPremiumTile({ leagueId: 'lg', userId: 'u-bo', email: null, tileId: 'exile_status', now: NOW })
    // Ed's move to Exile has not been read yet, so nobody is shown there and Bo is not on Exile.
    expect(result).toMatchObject({ ok: true, payload: { data: { enabled: true, returnWeek: 9, weeksUntilReturn: 4, tokensNeeded: 4, onExile: 0, you: { onExile: false } } } })
    expect(m.prisma.survivorPlayer.findUnique).not.toHaveBeenCalled()
  })
})

describe('host tiles', () => {
  const host = () => {
    m.role.mockResolvedValue('commissioner')
    m.plan.mockReturnValue('af_commissioner')
    ;(m.prisma.survivorChatMessage as any).groupBy = vi.fn().mockResolvedValue([{ senderUserId: 'u-bo', _max: { createdAt: NOW } }])
    m.prisma.integrityFlag.findMany.mockResolvedValue([])
    m.prisma.survivorAuditEntry.findMany.mockResolvedValue([{ targetUserId: 'u-cy' }])
  }

  it('a manager who is not the commissioner is refused, whatever their plan', async () => {
    m.plan.mockReturnValue('af_supreme')
    expect(await loadSurvivorPremiumTile({ leagueId: 'lg', userId: 'u-bo', email: null, tileId: 'risk_alerts', now: NOW })).toMatchObject({ ok: false, status: 403, access: { reason: 'commissioner_only' } })
    expect(m.prisma.integrityFlag.findMany).not.toHaveBeenCalled()
  })

  it('risk alerts for a non-playing host include missed ballots, read from the commissioner-visible audit', async () => {
    host()
    m.access.mockResolvedValue({ isLeagueMember: true, isParticipatingCommissioner: false, settings: { ...SURVIVOR_DEFAULT_FOUNDATION_SETTINGS }, canAccessTribeChat: false, rosterId: null })
    const result = await loadSurvivorPremiumTile({ leagueId: 'lg', userId: 'owner', email: null, tileId: 'risk_alerts', now: NOW })
    expect(m.prisma.integrityFlag.findMany.mock.calls[0][0].where).toEqual({ leagueId: 'lg', status: 'open' })
    expect(m.prisma.survivorAuditEntry.findMany.mock.calls[0][0]).toEqual({ where: { leagueId: 'lg', action: 'non_voter_auto_cast' }, select: { targetUserId: true } })
    expect(result).toMatchObject({ ok: true, payload: { tileId: 'risk_alerts', data: { showsMissedBallots: true } } })
    if (!result.ok || result.payload.tileId !== 'risk_alerts') return
    expect(result.payload.data.quiet.find(q => q.name === 'Cy')).toMatchObject({ missedBallots: 1 })
  })

  it('a commissioner who also plays never has missed ballots read at all', async () => {
    host()
    m.access.mockResolvedValue({ isLeagueMember: true, isParticipatingCommissioner: true, settings: { ...SURVIVOR_DEFAULT_FOUNDATION_SETTINGS }, canAccessTribeChat: true, rosterId: 'r-owner' })
    const result = await loadSurvivorPremiumTile({ leagueId: 'lg', userId: 'owner', email: null, tileId: 'risk_alerts', now: NOW })
    expect(m.prisma.survivorAuditEntry.findMany).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, payload: { data: { showsMissedBallots: false } } })
  })

  it('fairness radar counts late ballots only at councils already read out', async () => {
    host()
    m.prisma.survivorAuditEntry.count.mockResolvedValue(3)
    m.prisma.survivorVote.count.mockResolvedValue(1)
    m.prisma.survivorWeeklyScore.count = vi.fn().mockResolvedValue(0)
    m.prisma.survivorCommissionerAction.findMany.mockResolvedValue([])
    const councils = await m.prisma.survivorTribalCouncil.findMany()
    m.prisma.survivorTribalCouncil.findMany.mockResolvedValue(councils.map((c: any, i: number) => ({ ...c, id: `c${i + 4}` })))
    const result = await loadSurvivorPremiumTile({ leagueId: 'lg', userId: 'owner', email: null, tileId: 'host_fairness_radar', now: NOW })
    // Week 4 is read (c4); week 5 has not started its read (c5).
    expect(m.prisma.survivorVote.count.mock.calls[0][0]).toEqual({ where: { councilId: { in: ['c4'] }, isLateVote: true } })
    expect(result).toMatchObject({ ok: true, payload: { data: { councils: 2, autoCastBallots: 3, lateBallots: 1 } } })
  })
})

describe('loadSurvivorPremiumIndex', () => {
  it('reports each tile with the decision the tile endpoint will enforce', async () => {
    const index = await loadSurvivorPremiumIndex({ leagueId: 'lg', userId: 'u-bo', email: null })
    expect(index?.plan).toBe('af_pro')
    const byId = Object.fromEntries((index?.tiles ?? []).map(t => [t.tileId, t.access]))
    expect(byId.threat_map).toEqual({ ok: true })
    expect(byId.story_mode_controls).toEqual({ ok: false, reason: 'coming_next' })
  })
})
