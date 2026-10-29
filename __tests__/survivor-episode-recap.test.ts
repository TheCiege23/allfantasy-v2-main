// @vitest-environment node
/**
 * Survivor episode recaps (lib/survivor/episodeRecap.ts): Chimmy's recap after each Tribal Council,
 * for leagues that turned it on and whose owner has AF Commissioner. Never names who voted for whom.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  league: vi.fn(), user: vi.fn(), plan: vi.fn(), audit: vi.fn(), auditCreate: vi.fn(), council: vi.fn(), player: vi.fn(),
  tribe: vi.fn(), challenge: vi.fn(), count: vi.fn(), channel: vi.fn(), upsert: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: h.league }, appUser: { findUnique: h.user },
  survivorAuditEntry: { findFirst: h.audit, create: h.auditCreate },
  survivorTribalCouncil: { findFirst: h.council }, survivorPlayer: { findFirst: h.player, count: h.count },
  survivorTribe: { findUnique: h.tribe }, survivorChallenge: { findFirst: h.challenge }, survivorChatChannel: { findFirst: h.channel },
} }))
vi.mock('@/lib/entitlements/afCommissionerPlan', () => ({ hasAfCommissionerPlan: h.plan }))
vi.mock('@/lib/ai/providerRouter', () => ({ routeTextCall: vi.fn() }))
vi.mock('@/lib/survivor/survivorChatBridge', () => ({ upsertSurvivorChatMessage: h.upsert }))

import { countVotesByTarget, episodeFactsForPrompt, postSurvivorEpisodeRecap, type SurvivorEpisodeFacts } from '@/lib/survivor/episodeRecap'

const COUNCIL = {
  week: 4, councilNumber: 1, eliminatedName: 'Rafa', eliminatedUserId: 'u-rafa', attendingTribeId: 't1', tiePhase: null, idolsPlayed: [{ powerLabel: 'Hidden Immunity Idol' }],
  revealSequence: [
    { order: 1, targetName: 'Rafa', status: 'counts' }, { order: 2, targetName: 'Kim', status: 'counts' },
    { order: 3, targetName: 'Rafa', status: 'counts' }, { order: 4, targetName: 'Kim', status: 'blocked_by_idol' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockResolvedValue({ aiRecaps: true, userId: 'owner' })
  h.user.mockResolvedValue({ email: 'o@x.test', username: 'o' })
  h.plan.mockResolvedValue(true)
  h.audit.mockResolvedValue(null)
  h.council.mockResolvedValue(COUNCIL)
  h.player.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (where.userId ? { isJuryMember: true } : { displayName: 'Ana' }))
  h.tribe.mockImplementation(async ({ where }: { where: { id: string } }) => ({ name: where.id === 't1' ? 'Tagi' : 'Pagong' }))
  h.challenge.mockResolvedValue({ winnerTribeId: 't2' })
  h.count.mockResolvedValue(7)
  h.channel.mockResolvedValue({ id: 'ch1' })
})

const run = (write = vi.fn(async (f: SurvivorEpisodeFacts) => `🔥 Episode recap · Week ${f.week}\nThe tribe has spoken, ${f.votedOut}.`)) =>
  ({ write, result: postSurvivorEpisodeRecap({ leagueId: 'L', councilId: 'C1', outcome: 'removed_to_waivers', write }) })

describe('countVotesByTarget / episodeFactsForPrompt', () => {
  it('counts only ballots that counted, by target, most first', () => {
    expect(countVotesByTarget(COUNCIL.revealSequence as never)).toEqual([{ name: 'Rafa', count: 2 }, { name: 'Kim', count: 1 }])
  })

  it('the prompt carries counts by target and never a voter', () => {
    const text = episodeFactsForPrompt({ week: 4, councilNumber: 1, votedOut: 'Rafa', attendingTribe: 'Tagi', votes: [{ name: 'Rafa', count: 2 }], idols: [], tiebreak: null, challengeWinner: 'Pagong', immunity: null, destination: 'jury', remaining: 7 })
    expect(text).toContain('Vote: 2 for Rafa')
    expect(text).toContain('Rafa joins the jury.')
    expect(text).not.toMatch(/voted for/)
  })
})

describe('postSurvivorEpisodeRecap', () => {
  it('posts Chimmy\'s recap as the host, once per council, with the episode facts', async () => {
    const { write, result } = run()
    expect(await result).toBe('posted')
    const facts = write.mock.calls[0]![0]
    expect(facts).toMatchObject({ week: 4, votedOut: 'Rafa', attendingTribe: 'Tagi', challengeWinner: 'Pagong', immunity: 'Ana', destination: 'jury', remaining: 7, idols: ['Hidden Immunity Idol'] })
    const args = h.upsert.mock.calls[0]![1]
    expect(args.where).toEqual({ id: 'survivor-episode-recap:C1' })
    expect(args.create).toMatchObject({ channelId: 'ch1', senderName: 'Chimmy', senderIsHost: true, contentType: 'host_announcement' })
    expect(h.auditCreate.mock.calls[0]![0].data).toMatchObject({ action: 'episode_recap_posted', relatedEntityId: 'C1' })
  })

  it('off unless the league turned it on, and only on the owner\'s AF Commissioner plan', async () => {
    h.league.mockResolvedValueOnce({ aiRecaps: false, userId: 'owner' })
    expect(await run().result).toBe('off')
    h.plan.mockResolvedValueOnce(false)
    expect(await run().result).toBe('no_plan')
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('a council already recapped is not posted again', async () => {
    h.audit.mockResolvedValue({ id: 'a' })
    const { write, result } = run()
    expect(await result).toBe('already_posted')
    expect(write).not.toHaveBeenCalled()
  })

  it('if Chimmy is unavailable nothing extra is posted (the ceremony post already ran)', async () => {
    expect(await run(vi.fn(async () => null)).result).toBe('ai_unavailable')
    expect(h.upsert).not.toHaveBeenCalled()
    expect(h.auditCreate).not.toHaveBeenCalled()
  })
})
