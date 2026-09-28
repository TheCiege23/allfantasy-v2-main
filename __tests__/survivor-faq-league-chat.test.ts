/**
 * "Post FAQ & pin" (Survivor settings → League chat FAQ) is a commissioner broadcast, and it could
 * not post anywhere: it needed `settings.leagueChatThreadId`, which nothing sets (0 of 390 leagues in
 * production), so it always answered "Link a league chat thread in league settings". It now posts
 * into the league's own chat as a `broadcast` and pins it there — no link involved.
 *
 * The real `seedSurvivorFaqToLeagueChat` runs; the league chat writer is spied, and the Survivor
 * config row is in memory.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { seq: 0, faqSeededAt: null as Date | null, settings: {} as Record<string, unknown> }
  const prisma = {
    survivorLeagueConfig: {
      findUnique: vi.fn(async () => ({
        leagueId: 'L1',
        faqSeededAt: state.faqSeededAt,
        regularSeasonEndWeek: null,
        tribeCount: 4,
        mergeWeek: 8,
        mergeTrigger: 'week',
        exileReturnEnabled: true,
        exileReturnTokens: 3,
        challengesSystemRun: true,
        seasonThemeLabel: 'Island of Degenerates',
        league: { name: 'Degenerates', sport: 'NFL' },
      })),
      update: vi.fn(async ({ data }: { data: { faqSeededAt: Date } }) => {
        state.faqSeededAt = data.faqSeededAt
        return {}
      }),
    },
    // Whatever a reader of the old link would see: no link at all, as in production.
    league: { findUnique: vi.fn(async () => ({ settings: state.settings })) },
  }
  return {
    state,
    prisma,
    createLeagueChatMessage: vi.fn(async () => ({ id: `league-msg-${++state.seq}` })),
    createPlatformThreadTypedMessage: vi.fn(async () => ({ id: 'platform-msg' })),
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma, default: h.prisma }))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: h.createLeagueChatMessage }))
vi.mock('@/lib/platform/chat-service', () => ({ createPlatformThreadTypedMessage: h.createPlatformThreadTypedMessage }))
vi.mock('@/lib/survivor/SurvivorExileEngine', () => ({ getExileLeagueId: vi.fn(async () => 'L1-exile') }))

import { seedSurvivorFaqToLeagueChat } from '@/lib/survivor/survivorFaq'

beforeEach(() => {
  vi.clearAllMocks()
  h.state.seq = 0
  h.state.faqSeededAt = null
  h.state.settings = {}
})

describe('seedSurvivorFaqToLeagueChat', () => {
  it("posts the FAQ into the league's own chat as a commissioner broadcast, with no chat link set", async () => {
    const out = await seedSurvivorFaqToLeagueChat({ leagueId: 'L1', commissionerUserId: 'u-comm' })

    expect(out).toEqual({ ok: true, messageId: 'league-msg-1' })
    const [leagueId, userId, body, options] = h.createLeagueChatMessage.mock.calls[0] as unknown as [
      string,
      string,
      string,
      { type: string; metadata?: Record<string, unknown> },
    ]
    expect([leagueId, userId]).toEqual(['L1', 'u-comm'])
    expect(body).toContain('SURVIVOR LEAGUE FAQ — Degenerates')
    expect(options).toEqual({ type: 'broadcast', metadata: { survivorFaq: true } })
    expect(h.createPlatformThreadTypedMessage).not.toHaveBeenCalled()
  })

  it('pins it the way league chat pins — a pin row naming the FAQ message', async () => {
    await seedSurvivorFaqToLeagueChat({ leagueId: 'L1', commissionerUserId: 'u-comm' })

    const pin = h.createLeagueChatMessage.mock.calls[1] as unknown as [string, string, string, { type: string }]
    expect(pin[0]).toBe('L1')
    expect(pin[3]).toEqual({ type: 'pin' })
    const pinned = JSON.parse(pin[2]) as { messageId: string; snippet: string }
    expect(pinned.messageId).toBe('league-msg-1')
    expect(pinned.snippet.length).toBeLessThanOrEqual(121)
    expect(h.state.faqSeededAt).toBeInstanceOf(Date)
  })

  it('still ignores a stored DM link — it never posts into a platform thread', async () => {
    h.state.settings = { leagueChatThreadId: 'thread-dm-comm-and-manager' }
    await seedSurvivorFaqToLeagueChat({ leagueId: 'L1', commissionerUserId: 'u-comm' })
    expect(h.createPlatformThreadTypedMessage).not.toHaveBeenCalled()
    expect(h.createLeagueChatMessage).toHaveBeenCalledTimes(2)
  })

  it('skips a second post unless forced', async () => {
    h.state.faqSeededAt = new Date('2026-09-01T00:00:00Z')
    expect(await seedSurvivorFaqToLeagueChat({ leagueId: 'L1', commissionerUserId: 'u-comm' })).toEqual({ ok: true })
    expect(h.createLeagueChatMessage).not.toHaveBeenCalled()
  })
})
