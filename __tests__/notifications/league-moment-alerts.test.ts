// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * League moments that used to happen in silence (2026-11-15):
 *   1. a two-team redraft or draft-pick trade accepted / declined / vetoed / processed / withdrawn / expired —
 *      only a system line in the DM, which raises no alert;
 *   2. a redraft waiver claim won or lost — nothing at all;
 *   3. clinching a playoff spot or being eliminated in a native league — shown, never told;
 *   4. a friend joining from your invite — only the commissioner was told.
 */

const m = vi.hoisted(() => ({
  dispatch: vi.fn(async (_input: Record<string, unknown>) => ({ delivered: 1, failed: 0 })),
  createSystemMessage: vi.fn(async () => ({ id: 'msg-status' })),
  db: {} as Record<string, any>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: new Proxy({}, { get: (_t, k: string) => m.db[k] }) }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatch }))
vi.mock('@/lib/platform/chat-service', () => ({
  createSystemMessage: m.createSystemMessage,
  createPlatformThread: vi.fn(),
  createPlatformThreadMessage: vi.fn(),
}))
vi.mock('@/lib/guillotine/lateStartSeats', () => ({ resolveGuillotineEffectiveSeats: async () => null }))

import { tradeStatusAlertFor, tradeStatusHref, tradeStatusRecipients } from '@/lib/chat-notifications/tradeStatusAlert'
import { postTradeStatusToDm } from '@/lib/chat-notifications/tradeOfferDm'
import { notifyNativePlayoffStatus, playoffStatusCopy } from '@/lib/redraft/playoffStatusNotify'
import { notifyInviterOfJoin } from '@/lib/league-join/notifyCommissionerOfJoin'

beforeEach(() => {
  m.dispatch.mockClear()
  m.createSystemMessage.mockClear()
  m.db = {}
})

describe('trade results reach the other manager', () => {
  it('redraft and draft-pick trades only — the trade engine, Sleeper and Yahoo already send their own', () => {
    expect(tradeStatusAlertFor('redraft', 'accepted')?.title).toBe('Trade accepted')
    expect(tradeStatusAlertFor('draft_pick', 'rejected')?.title).toBe('Trade declined')
    expect(tradeStatusAlertFor('redraft', 'vetoed')?.email).toBe(true)
    expect(tradeStatusAlertFor('redraft', 'expired')?.email).toBe(false)
    expect(tradeStatusAlertFor('native', 'accepted')).toBeNull()
    expect(tradeStatusAlertFor('sleeper', 'accepted')).toBeNull()
    expect(tradeStatusAlertFor('redraft', 'pending')).toBeNull()
    expect(tradeStatusAlertFor('redraft', 'countered')).toBeNull()
  })

  it('nobody hears about their own answer; a veto or expiry reaches both', () => {
    expect(tradeStatusRecipients(['proposer', 'receiver'], 'receiver')).toEqual(['proposer'])
    expect(tradeStatusRecipients(['proposer', 'receiver'], null)).toEqual(['proposer', 'receiver'])
  })

  it("opens the recipient's own trade link", () => {
    expect(tradeStatusHref({ href: '/a', hrefs: { u1: '/mine' } }, 'u1')).toBe('/mine')
    expect(tradeStatusHref({ href: '/a', hrefs: { u1: '/mine' } }, 'u2')).toBe('/a')
    expect(tradeStatusHref({ leagueId: 'lg 1' }, 'u2')).toBe('/league/lg%201?view=trades')
  })

  function dmDb(postedFor: string) {
    const claims = new Set<string>()
    return {
      sportsDataCache: {
        findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) =>
          where.cacheKey.endsWith(`${postedFor}:offer`) ? { data: { state: 'posted', threadId: 'th-1', messageId: 'msg-offer' } } : null),
        create: vi.fn(async ({ data }: { data: { cacheKey: string } }) => {
          if (claims.has(data.cacheKey)) throw Object.assign(new Error('dupe'), { code: 'P2002' })
          claims.add(data.cacheKey)
          return {}
        }),
        update: vi.fn(async () => ({})),
        deleteMany: vi.fn(async () => ({})),
      },
      platformChatMessage: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) },
      appUser: { findUnique: vi.fn(async () => ({ displayName: 'Rae', username: 'rae' })) },
      platformChatThreadMember: { findMany: vi.fn(async () => [{ userId: 'proposer' }, { userId: 'receiver' }]) },
    }
  }

  it('an accepted redraft trade alerts the proposer, once, with the DM line as the message', async () => {
    m.db = dmDb('redraft:tr-1')
    await postTradeStatusToDm({ source: 'redraft', tradeId: 'tr-1', status: 'accepted', actorUserId: 'receiver' })
    await vi.waitFor(() => expect(m.dispatch).toHaveBeenCalledTimes(1))
    const sent = m.dispatch.mock.calls[0]![0]
    expect(sent).toMatchObject({ userIds: ['proposer'], category: 'trade_accept_reject', type: 'trade_accepted', title: 'Trade accepted' })
    expect(String(sent.body)).toContain('Rae accepted the trade.')
    // Retried accept: the DM line is claimed, so neither the line nor the alert repeats.
    await postTradeStatusToDm({ source: 'redraft', tradeId: 'tr-1', status: 'accepted', actorUserId: 'receiver' })
    await new Promise((r) => setTimeout(r, 20))
    expect(m.dispatch).toHaveBeenCalledTimes(1)
  })

  it('an imported or trade-engine trade gets its line and no second alert from here', async () => {
    m.db = dmDb('sleeper:tr-2')
    const r = await postTradeStatusToDm({ source: 'sleeper', tradeId: 'tr-2', status: 'accepted', actorUserId: 'receiver' })
    expect(r.posted).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(m.dispatch).not.toHaveBeenCalled()
  })
})

describe('clinched and eliminated, in a native league', () => {
  function seasonDb(opts: { platform?: string; sent?: string[] } = {}) {
    return {
      redraftSeason: { findUnique: vi.fn(async () => ({ leagueId: 'lg-1', season: 2026, league: { name: 'Dynasty Bros', platform: opts.platform ?? 'allfantasy' } })) },
      redraftRoster: {
        findMany: vi.fn(async () => [
          { id: 'r1', ownerId: 'u1', teamName: 'Gridiron Gurus', ownerName: 'Ann' },
          { id: 'r2', ownerId: 'u2', teamName: null, ownerName: 'Ben' },
          { id: 'r3', ownerId: 'open-slot-3', teamName: 'Open', ownerName: null },
        ]),
      },
      platformNotification: { findMany: vi.fn(async () => (opts.sent ?? []).map((sourceKey) => ({ sourceKey }))) },
    }
  }
  const statuses = async () => ({ season: 2026, statuses: new Map([['r1', 'clinched'], ['r2', 'eliminated'], ['r3', 'eliminated']] as const) })

  it('tells each manager once, in plain words, and never an open seat', async () => {
    const r = await notifyNativePlayoffStatus({ prisma: seasonDb() as never, seasonId: 's1' }, { loadStatuses: statuses as never, dispatch: m.dispatch })
    expect(r.notified).toBe(2)
    expect(m.dispatch.mock.calls.map((c) => [c[0].userIds, c[0].type, c[0].title, c[0].dedupePrefix])).toEqual([
      [['u1'], 'playoff_clinched', 'You clinched a playoff spot in Dynasty Bros', 'playoff-status:lg-1:2026:clinched'],
      [['u2'], 'playoff_eliminated', 'Your playoff race is over in Dynasty Bros', 'playoff-status:lg-1:2026:eliminated'],
    ])
    expect(m.dispatch.mock.calls[0]![0]).toMatchObject({ category: 'matchup_results', actionHref: '/league/lg-1/standings' })
  })

  it('a re-run, or a manager already told by the rebuild notice, hears nothing new', async () => {
    const r = await notifyNativePlayoffStatus(
      { prisma: seasonDb({ sent: ['playoff-status:lg-1:2026:clinched:u1', 'rebuild-plan-ready:lg-1:2026:u2'] }) as never, seasonId: 's1' },
      { loadStatuses: statuses as never, dispatch: m.dispatch },
    )
    expect(r.notified).toBe(0)
    expect(m.dispatch).not.toHaveBeenCalled()
  })

  it('an imported league is left to its own app, and an uncertifiable one sends nothing', async () => {
    expect((await notifyNativePlayoffStatus({ prisma: seasonDb({ platform: 'sleeper' }) as never, seasonId: 's1' }, { loadStatuses: statuses as never, dispatch: m.dispatch })).notified).toBe(0)
    expect((await notifyNativePlayoffStatus({ prisma: seasonDb() as never, seasonId: 's1' }, { loadStatuses: async () => null, dispatch: m.dispatch })).notified).toBe(0)
    expect(m.dispatch).not.toHaveBeenCalled()
  })

  it('reads the way a manager talks', () => {
    expect(playoffStatusCopy('clinched', 'Gridiron Gurus', 'Dynasty Bros').body).toBe('Gridiron Gurus is in. Every game from here is about seeding.')
    expect(playoffStatusCopy('eliminated', '', '').title).toBe('Your playoff race is over in your league')
  })
})

describe('"your friend joined from your invite"', () => {
  function joinDb(opts: { referrer?: string | null; inviterPlays?: boolean; commissioner?: string } = {}) {
    return {
      referral: { findUnique: vi.fn(async () => (opts.referrer === null ? null : { referrerId: opts.referrer ?? 'inviter' })) },
      league: { findUnique: vi.fn(async () => ({ name: 'Dynasty Bros', userId: opts.commissioner ?? 'commish' })) },
      leagueTeam: { findFirst: vi.fn(async () => (opts.inviterPlays === false ? null : { id: 't1' })) },
      userProfile: { findFirst: vi.fn(async () => ({ displayName: 'Sam' })) },
    }
  }

  it('tells the leaguemate who brought them, once per league and joiner, bell and phone only', async () => {
    m.db = joinDb()
    await notifyInviterOfJoin({ leagueId: 'lg-1', joinerUserId: 'sam' })
    expect(m.dispatch).toHaveBeenCalledTimes(1)
    expect(m.dispatch.mock.calls[0]![0]).toMatchObject({
      userIds: ['inviter'],
      type: 'league_invite_accepted',
      title: 'Sam joined Dynasty Bros',
      dedupePrefix: 'league_invite_accepted:lg-1:sam',
      skipChannels: { email: true, sms: true },
    })
  })

  it('nobody, when there was no invite, the inviter does not play there, or the inviter is the commissioner (already told)', async () => {
    for (const db of [joinDb({ referrer: null }), joinDb({ inviterPlays: false }), joinDb({ commissioner: 'inviter' })]) {
      m.db = db
      await notifyInviterOfJoin({ leagueId: 'lg-1', joinerUserId: 'sam' })
    }
    expect(m.dispatch).not.toHaveBeenCalled()
  })
})
