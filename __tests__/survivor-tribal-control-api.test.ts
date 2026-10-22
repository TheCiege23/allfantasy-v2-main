// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const m = vi.hoisted(() => ({
  session: vi.fn(), access: vi.fn(), context: vi.fn(), tally: vi.fn(), reveal: vi.fn(), close: vi.fn(), elimination: vi.fn(), push: vi.fn(),
  db: {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
    league: { findUnique: vi.fn(), update: vi.fn() },
    survivorLeagueConfig: { upsert: vi.fn() },
    survivorPlayer: { findMany: vi.fn() },
    survivorVote: { findMany: vi.fn(), findFirst: vi.fn() },
    survivorGameState: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    survivorTribalCouncil: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    survivorCommissionerAction: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    survivorAuditEntry: { findMany: vi.fn(), create: vi.fn() },
    platformNotification: { create: vi.fn() },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: m.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league/permissions', () => ({ getLeagueRole: vi.fn(), requireCommissionerRole: vi.fn(async () => { if (role === 'member') throw new Response('Forbidden', { status: 403 }) }) }))
vi.mock('@prisma/client', () => ({ Prisma: { JsonNull: null } }))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/survivorAccessControl', async original => ({ ...await original<typeof import('@/lib/survivor/survivorAccessControl')>(), resolveSurvivorAccessContext: m.access }))
vi.mock('@/lib/survivor/survivorCouncilService', () => ({ loadCouncilContext: m.context, getLatestCouncil: vi.fn(), closeVoteWindow: m.close, openTribalCouncil: vi.fn(), cancelCouncil: vi.fn() }))
vi.mock('@/lib/survivor/survivorVoteTallyService', () => ({ tallyCouncil: m.tally, revealCouncil: m.reveal, publishCouncilVerdictIfComplete: vi.fn(async () => ({ ok: true, complete: true, published: true, isTie: false, eliminatedUserId: 'out' })) }))
vi.mock('@/lib/survivor/survivorEliminationService', () => ({ resolveElimination: m.elimination }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: m.push }))
vi.mock('@/lib/survivor/notificationEngine', async original => ({ ...await original<typeof import('@/lib/survivor/notificationEngine')>(), enqueueNotification: vi.fn() }))
import { buildSurvivorAccessContextFromSnapshot } from '@/lib/survivor/survivorAccessControl'
import { POST } from '@/server/api-route-modules/league-survivor/foundation/route'
import { POST as legacyPost } from '@/app/api/survivor/commissioner/route'

const now = new Date('2026-10-15T12:00:00Z')
const deadline = new Date('2026-10-15T14:00:00Z')
let ctx: any
let game: any
let actions: any[]
let role: 'commissioner' | 'co_commissioner' | 'member'
let playing: boolean
let hideIdols: boolean
const request = (action: string, body: object = {}) => POST(new NextRequest('http://localhost/api/leagues/l/survivor', { method: 'POST', body: JSON.stringify({ action, ...body }) }), { params: { leagueId: 'l' } })

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers(); vi.setSystemTime(now)
  role = 'commissioner'; playing = false; hideIdols = true; actions = []
  ctx = { council: { id: 'c', week: 6, status: 'voting_open', phase: 'pre_merge', attendingTribeId: 't', voteDeadlineAt: deadline, tiePlayerIds: [], idolsPlayed: [{ playerUserId: 'b', extraTargetUserId: 'secret' }] }, scopePlayers: [{ userId: 'a', displayName: 'A' }, { userId: 'b', displayName: 'B' }], rosterToUser: { ra: 'a', rb: 'b' }, eligibility: { voterUserIds: ['a', 'b'] } }
  game = { currentWeek: 6, weekScoringLockedAt: now, weekScoringFinalAt: now, immuneTribeId: 'safe', pausedSnapshot: null, needsTribalLock: true, needsExileScore: true }
  m.session.mockResolvedValue({ user: { id: 'host' } })
  m.access.mockImplementation(async () => buildSurvivorAccessContextFromSnapshot({ leagueId: 'l', userId: 'host', role, settings: { hideIdolsFromCommissioner: hideIdols, coCommissionerMode: 'non_participating_host' }, player: playing ? { userId: 'host', playerState: 'active' } : null }))
  m.context.mockImplementation(async () => ctx)
  m.db.$transaction.mockImplementation(async fn => fn(m.db))
  m.db.survivorGameState.findUnique.mockImplementation(async () => game)
  m.db.survivorGameState.update.mockImplementation(async ({ data }) => Object.assign(game, data))
  m.db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'a', displayName: 'A' }, { userId: 'b', displayName: 'B' }])
  m.db.survivorVote.findMany.mockResolvedValue([{ voterUserId: 'a', voterRosterId: 'ra', doesNotCount: false, targetUserId: 'SECRET-CHOICE' }])
  m.db.survivorTribalCouncil.findUnique.mockResolvedValue({ isRevealed: false, revealSequence: [{ targetUserId: 'SECRET-CHOICE' }], tiePhase: 'revote_required', tiePlayerIds: ['a'], eliminatedUserId: 'SECRET-CHOICE' })
  m.db.survivorTribalCouncil.findFirst.mockImplementation(async () => ctx.council)
  m.db.survivorTribalCouncil.findMany.mockImplementation(async () => [ctx.council])
  m.db.survivorTribalCouncil.update.mockImplementation(async ({ data }) => Object.assign(ctx.council, data))
  m.db.survivorCommissionerAction.findMany.mockImplementation(async () => actions)
  m.db.survivorCommissionerAction.findFirst.mockImplementation(async () => actions.find(a => a.actionType === 'council_vote_nudge'))
  m.db.survivorCommissionerAction.create.mockImplementation(async ({ data }) => { const entry = { id: String(actions.length), ...data, executedAt: now }; actions.push(entry); return entry })
  m.db.survivorAuditEntry.findMany.mockResolvedValue([])
  m.db.league.findUnique.mockResolvedValue({ settings: {}, sport: 'NFL' })
  m.close.mockResolvedValue({ ok: true, councilId: 'c' })
  m.tally.mockResolvedValue({ ok: true, tally: { countsByTargetName: { 'SECRET-CHOICE': 2 } } })
  m.reveal.mockResolvedValue({ ok: true, eliminatedUserId: 'b', revealSequence: [{ targetUserId: 'SECRET-CHOICE' }] })
  m.elimination.mockResolvedValue({ ok: true })
  m.push.mockResolvedValue([])
})

afterEach(() => vi.useRealTimers())

const mutations = ['nudge-voter', 'extend-votes-hour', 'pause-league', 'resume-league', 'set-auto-reveal', 'close-vote-window', 'tally-votes', 'reveal-votes']
describe('Tribal control authorization', () => {
  it.each(['council-control', ...mutations])('rejects a non-commissioner for %s before work', async action => {
    role = 'member'
    expect((await request(action)).status).toBe(403)
    expect(m.context).not.toHaveBeenCalled(); expect(m.db.$transaction).not.toHaveBeenCalled()
    expect(m.close).not.toHaveBeenCalled(); expect(m.reveal).not.toHaveBeenCalled(); expect(m.db.league.update).not.toHaveBeenCalled()
  })
  it.each(mutations)('playing commissioners cannot perform %s through host controls', async action => {
    playing = true
    expect((await request(action)).status).toBe(403)
    expect(m.db.$transaction).not.toHaveBeenCalled(); expect(m.context).not.toHaveBeenCalled()
  })
  it('allows an independent co-commissioner to extend', async () => {
    role = 'co_commissioner'
    expect((await request('extend-votes-hour')).status).toBe(200)
    expect(m.db.survivorTribalCouncil.update).toHaveBeenCalledOnce()
  })
})

function assertNoChoices(value: unknown) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    expect(key).not.toMatch(/target|votechoice|revealSequence|idolsPlayed|tiePlayer|tiePhase|countsBy/i)
    assertNoChoices(child)
  }
  expect(JSON.stringify(value)).not.toContain('SECRET-CHOICE')
}

describe('sealed projection', () => {
  it('keeps a playing commissioner blind even when the hide-idols setting is off', async () => {
    playing = true; hideIdols = false
    const response = await request('council-control')
    const data = await response.json()
    expect(response.status).toBe(200); expect(data.idolsHidden).toBe(true)
    expect(data.canControl).toBe(false); assertNoChoices(data)
  })
  it.each([false, true])('never returns choices to a commissioner (playing=%s)', async isPlaying => {
    playing = isPlaying
    actions.push({ id: 'hostile-audit', actionType: 'council_vote_nudge', description: 'SECRET-CHOICE', executedAt: now, targetUserId: 'SECRET-CHOICE' })
    const response = await request('council-control'); expect(response.status).toBe(200)
    const data = await response.json(); assertNoChoices(data)
    expect(data.canControl).toBe(!playing); expect(data.idolsHidden).toBe(true)
    expect(data.canReveal).toBe(false)
    expect(data.voters.map((v: any) => v.status)).toEqual(['voted', 'not_yet'])
    expect(m.db.survivorVote.findMany.mock.calls[0][0].select).toEqual({ voterUserId: true, voterRosterId: true, doesNotCount: true })
  })
  it('does not expose a secret forfeited vote through attendance', async () => {
    ctx.eligibility.voterUserIds = ['a']
    const data = await (await request('council-control')).json()
    expect(data.eligibleVoterCount).toBe(2); expect(data.voters).toHaveLength(2)
    assertNoChoices(data)
  })
  it('leaves out whoever the first council of a double-elimination week voted out', async () => {
    ctx.council.councilNumber = 2
    m.db.survivorTribalCouncil.findMany.mockImplementation(async ({ where }) => where?.councilNumber ? [{ eliminatedUserId: 'b' }] : [ctx.council])
    const data = await (await request('council-control')).json()
    expect(m.db.survivorTribalCouncil.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ week: 6, councilNumber: { lt: 2 } }) }))
    expect(data.voters.map((v: { userId: string }) => v.userId)).toEqual(['a'])
  })
  it('reports missed votes after the deadline and keeps them after the read', async () => {
    ctx.council.status = 'revealed'
    m.db.survivorTribalCouncil.findUnique.mockResolvedValue({ isRevealed: true, revealSequence: [{ targetUserId: 'SECRET-CHOICE' }] })
    const data = await (await request('council-control')).json()
    expect(data.voters[1].status).toBe('missed'); assertNoChoices(data)
  })
})

describe('guarded operational actions', () => {
  it('keeps the legacy pause entry point on the same snapshot and host-control guard', async () => {
    const legacyRequest = () => legacyPost(new NextRequest('http://localhost/api/survivor/commissioner', { method: 'POST', body: JSON.stringify({ leagueId: 'l', action: 'pause_season' }) }))
    playing = true
    expect((await legacyRequest()).status).toBe(403)
    expect(m.db.$transaction).not.toHaveBeenCalled()
    playing = false
    // Legacy notification delivery is mocked; the shared transaction owns pause/audit.
    expect((await legacyRequest()).status).toBe(200)
    expect(game.pausedSnapshot.pausedAt).toBe(now.toISOString())
    expect(actions[0].actionType).toBe('pause_season')
  })
  it('sends exactly one push and audits it; rejects repeat presses', async () => {
    expect((await request('nudge-voter', { targetUserId: 'b' })).status).toBe(200)
    expect((await request('nudge-voter', { targetUserId: 'b' })).status).toBe(429)
    expect(m.push).toHaveBeenCalledTimes(1); expect(m.push.mock.calls[0][0]).toBe('b')
    expect(m.db.platformNotification.create).toHaveBeenCalledOnce()
    expect(actions.map(a => a.actionType)).toEqual(['council_vote_nudge'])
    const data = await (await request('council-control')).json()
    expect(data.audit[0].actionType).toBe('council_vote_nudge'); assertNoChoices(data)
  })
  it('does not nudge an already submitted voter', async () => {
    m.db.survivorVote.findFirst.mockResolvedValue({ id: 'v' })
    expect((await request('nudge-voter', { targetUserId: 'a' })).status).toBe(429)
    expect(m.push).not.toHaveBeenCalled(); expect(actions).toEqual([])
  })
  it('moves both deadlines exactly one hour, pushes each voter and audits', async () => {
    const response = await request('extend-votes-hour')
    expect(await response.json()).toEqual({ ok: true, deadline: '2026-10-15T15:00:00.000Z' })
    expect(m.db.survivorTribalCouncil.update.mock.calls[0][0].data).toEqual({ voteDeadlineAt: new Date(deadline.getTime() + 3600000), votingDeadline: new Date(deadline.getTime() + 3600000) })
    expect(m.db.survivorGameState.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { tribalDeadline: new Date('2026-10-15T15:00:00Z') } }))
    expect(m.push.mock.calls.map(call => call[0])).toEqual(['a', 'b'])
    expect(actions[0].actionType).toBe('council_vote_extended')
  })
  it('pauses idempotently, freezes actions, resumes with remaining time and audits both', async () => {
    expect((await request('pause-league')).status).toBe(200)
    expect(game.pausedSnapshot).toMatchObject({ needsTribalLock: true, needsExileScore: true, pausedAt: now.toISOString() })
    expect(game.needsTribalLock).toBe(false)
    await request('pause-league'); expect(actions).toHaveLength(1)
    expect((await request('reveal-votes')).status).toBe(409); expect(m.reveal).not.toHaveBeenCalled()
    expect((await request('extend-votes-hour')).status).toBe(409)
    vi.setSystemTime(new Date(now.getTime() + 7200000))
    expect((await request('resume-league')).status).toBe(200)
    expect(ctx.council.voteDeadlineAt).toEqual(new Date(deadline.getTime() + 7200000))
    expect(game.needsTribalLock).toBe(true); expect(game.needsExileScore).toBe(true); expect(game.pausedSnapshot).toBeNull()
    expect(actions.map(a => a.actionType)).toEqual(['pause_season', 'resume_season'])
  })
  it.each([true, false])('persists reveal mode %s in existing settings and audits', async enabled => {
    m.db.league.findUnique.mockResolvedValue({ settings: { autoReveal: !enabled, unrelatedSetting: 'preserved' } })
    const response = await request('set-auto-reveal', { enabled })
    expect(response.status).toBe(200)
    expect(m.db.league.update.mock.calls[0][0].data.settings.survivorFoundationSettings.autoReveal).toBe(enabled)
    expect(m.db.league.update.mock.calls[0][0].data.settings.autoReveal).toBe(enabled)
    expect(m.db.league.update.mock.calls[0][0].data.settings.unrelatedSetting).toBe('preserved')
    expect(actions[0]).toMatchObject({ actionType: 'council_reveal_mode', week: 6 })
  })
  it('closes and tallies in one request without returning the tally', async () => {
    const response = await request('close-vote-window', { councilId: 'c' })
    expect(response.status).toBe(200); assertNoChoices(await response.json())
    expect(m.close).toHaveBeenCalledWith('l', 'c', 'host'); expect(m.tally).toHaveBeenCalledWith('l', 'c')
  })
  it('publishes the read and runs aftermath without returning scroll contents', async () => {
    const response = await request('reveal-votes', { councilId: 'c' })
    expect(response.status).toBe(200); assertNoChoices(await response.json())
    expect(m.elimination).toHaveBeenCalledWith('l', 'c', 'host')
  })
})
