// @vitest-environment node
/**
 * "When a trade is sent to a user, does it show up in the private message between that user and
 * the other user … so the user can find it quickly?" (owner, 2026-09-25). Before this, no.
 *
 * postTradeOfferToDm / postTradeStatusToDm, over an in-memory SportsDataCache that honours the
 * unique-key contract, and the card loaders over mocked rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  users: new Set<string>(['uA', 'uB', 'uC']),
  blocks: [] as Array<{ blockerUserId: string; blockedUserId: string }>,
  messages: new Map<string, { metadata: unknown }>(),
  createThread: vi.fn(),
  postAsUser: vi.fn(),
  postSystem: vi.fn(),
  trade: null as unknown,
  rosters: [] as unknown[],
  redraft: null as unknown,
  redraftRosters: [] as unknown[],
  draftProposal: null as unknown,
  draftRoster: null as unknown,
  profilesBySleeperId: new Map<string, string>(),
  yahooTheirs: null as null | { claimedByUserId: string; teamName: string; leagueId: string },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/platform/chat-service', () => ({
  createPlatformThread: h.createThread,
  createPlatformThreadMessage: h.postAsUser,
  createSystemMessage: h.postSystem,
}))
vi.mock('@/lib/prisma', () => {
  const p2002 = () => Object.assign(new Error('unique'), { code: 'P2002' })
  return {
    prisma: {
      sportsDataCache: {
        create: async ({ data }: { data: { cacheKey: string; data: unknown; expiresAt: Date } }) => {
          if (h.cache.has(data.cacheKey)) throw p2002()
          h.cache.set(data.cacheKey, { data: data.data, expiresAt: data.expiresAt })
          return {}
        },
        update: async ({ where, data }: { where: { cacheKey: string }; data: { data: unknown } }) => {
          const row = h.cache.get(where.cacheKey)
          if (!row) throw new Error('not found')
          row.data = data.data
          return {}
        },
        deleteMany: async ({ where }: { where: { cacheKey: string } }) => {
          h.cache.delete(where.cacheKey)
          return { count: 1 }
        },
        findUnique: async ({ where }: { where: { cacheKey: string } }) => {
          const row = h.cache.get(where.cacheKey)
          return row ? { data: row.data } : null
        },
      },
      appUser: {
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in
            .filter((id) => h.users.has(id))
            .map((id) => ({ id, displayName: id === 'uA' ? 'Dana' : id === 'uB' ? 'bob@example.org' : null, username: `${id}_user` })),
        findUnique: async ({ where }: { where: { id: string } }) =>
          h.users.has(where.id) ? { displayName: where.id === 'uB' ? 'Bob' : 'Dana', username: null } : null,
      },
      platformBlockedUser: {
        findFirst: async ({ where }: { where: { OR: Array<{ blockerUserId: string; blockedUserId: string }> } }) =>
          h.blocks.find((b) => where.OR.some((o) => o.blockerUserId === b.blockerUserId && o.blockedUserId === b.blockedUserId)) ?? null,
      },
      platformChatMessage: {
        findUnique: async ({ where }: { where: { id: string } }) => h.messages.get(where.id) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: { metadata: unknown } }) => {
          h.messages.set(where.id, { metadata: data.metadata })
          return {}
        },
      },
      afLeagueTrade: { findUnique: async () => h.trade },
      roster: {
        findMany: async () => h.rosters,
        findUnique: async () => h.draftRoster,
      },
      league: { findUnique: async () => ({ name: 'Pirate League' }) },
      leagueTeam: {
        findMany: async () => [{ claimedByUserId: 'uA', platformUserId: 'uA', externalId: 'rA', teamName: 'Dana Dynasty' }],
        findFirst: async ({ where }: { where: { claimedByUserId?: unknown } }) =>
          typeof where.claimedByUserId === 'string' ? { teamName: 'Dana Dynasty' } : h.yahooTheirs,
      },
      sportsPlayer: {
        findMany: async () => [{ sleeperId: 'p2', name: 'C.J. Stroud', position: 'QB', team: 'HOU' }],
      },
      userProfile: {
        findMany: async ({ where }: { where: { sleeperUserId: { in: string[] } } }) =>
          where.sleeperUserId.in.filter((s) => h.profilesBySleeperId.has(s)).map((s) => ({ userId: h.profilesBySleeperId.get(s), sleeperUserId: s })),
      },
      redraftTradeProposal: { findUnique: async () => h.redraft },
      redraftRoster: { findMany: async () => h.redraftRosters },
      draftPickTradeProposal: { findUnique: async () => h.draftProposal },
    },
  }
})

import {
  findOrCreateDirectThread,
  postTradeOfferToDm,
  postTradeStatusToDm,
  queueTradeStatusInDm,
  tradeOfferDmKey,
} from '@/lib/chat-notifications/tradeOfferDm'
import {
  loadDraftPickTradeOffer,
  loadNativeTradeOffer,
  loadRedraftTradeOffer,
  postImportedOfferToDm,
  postYahooOffersToDms,
} from '@/lib/chat-notifications/tradeOfferSources'
import { buildTradeOfferMessageText, type TradeOfferCard } from '@/lib/chat-notifications/tradeOfferCard'

const CARD: TradeOfferCard = {
  v: 1,
  source: 'native',
  tradeId: 'trade-1',
  leagueId: 'L1',
  leagueName: 'Pirate League',
  proposer: { manager: 'Dana', gives: [{ label: 'Nico Collins' }] },
  receiver: { manager: 'Bob', gives: [{ label: 'C.J. Stroud' }] },
  note: null,
  status: 'pending',
  href: '/league/L1?view=trades&tradeId=trade-1',
  hrefs: null,
  directionKnown: true,
  answerOn: null,
  createdAt: '2026-09-25T18:00:00.000Z',
}

const loadCard = vi.fn(async () => ({ card: CARD, proposerUserId: 'uA', receiverUserId: 'uB', postAsUserId: 'uA' }))

beforeEach(() => {
  h.cache.clear()
  h.blocks = []
  h.messages.clear()
  h.users = new Set(['uA', 'uB', 'uC'])
  h.profilesBySleeperId.clear()
  h.yahooTheirs = null
  loadCard.mockClear()
  h.createThread.mockReset()
  h.createThread.mockResolvedValue({ id: 'dm-1' })
  h.postAsUser.mockReset()
  h.postAsUser.mockImplementation(async (_u: string, _t: string, _b: string, _type: string, metadata: unknown) => {
    h.messages.set('offer-msg', { metadata })
    return { id: 'offer-msg' }
  })
  h.postSystem.mockReset()
  h.postSystem.mockResolvedValue({ id: 'status-msg' })
})

describe('posting the offer into the two managers’ DM', () => {
  it('finds-or-creates their DM through the dm/start service and posts AS the proposer, with the card in metadata', async () => {
    const r = await postTradeOfferToDm({ source: 'native', tradeId: 'trade-1', load: loadCard })
    expect(r).toEqual({ posted: true, threadId: 'dm-1', messageId: 'offer-msg' })
    expect(h.createThread).toHaveBeenCalledWith({ creatorUserId: 'uA', threadType: 'dm', productType: 'shared', memberUserIds: ['uB'] })
    expect(h.postAsUser).toHaveBeenCalledWith('uA', 'dm-1', buildTradeOfferMessageText(CARD), 'text', { tradeOffer: CARD })
  })

  it('🛑 once per offer: a second call posts nothing and never even loads the card', async () => {
    await postTradeOfferToDm({ source: 'native', tradeId: 'trade-1', load: loadCard })
    const again = await postTradeOfferToDm({ source: 'native', tradeId: 'trade-1', load: loadCard })
    expect(again).toEqual({ posted: false, reason: 'already_posted' })
    expect(loadCard).toHaveBeenCalledTimes(1)
    expect(h.postAsUser).toHaveBeenCalledTimes(1)
  })

  it('a blocked pair gets no DM — and the refusal is remembered, not retried', async () => {
    h.blocks = [{ blockerUserId: 'uB', blockedUserId: 'uA' }]
    expect(await postTradeOfferToDm({ source: 'native', tradeId: 'trade-1', load: loadCard })).toEqual({ posted: false, reason: 'blocked' })
    expect(h.createThread).not.toHaveBeenCalled()
    expect(await postTradeOfferToDm({ source: 'native', tradeId: 'trade-1', load: loadCard })).toEqual({ posted: false, reason: 'already_posted' })
  })

  it('never opens a DM with someone who has no AllFantasy account', async () => {
    expect(await findOrCreateDirectThread('uA', 'sleeper-only-person')).toEqual({ refused: 'unknown_user' })
    expect(h.createThread).not.toHaveBeenCalled()
  })

  it('a failed post releases the claim so the next attempt can try again', async () => {
    h.postAsUser.mockResolvedValueOnce(null)
    expect(await postTradeOfferToDm({ source: 'native', tradeId: 'trade-1', load: loadCard })).toEqual({ posted: false, reason: 'post_failed' })
    expect(h.cache.has(tradeOfferDmKey('native', 'trade-1'))).toBe(false)
    expect((await postTradeOfferToDm({ source: 'native', tradeId: 'trade-1', load: loadCard })).posted).toBe(true)
  })

  it('a direction-unknown (Yahoo) offer is posted as a system message, in nobody’s mouth', async () => {
    await postTradeOfferToDm({
      source: 'yahoo',
      tradeId: 'y1',
      load: async () => ({ card: { ...CARD, source: 'yahoo', directionKnown: false }, proposerUserId: 'uA', receiverUserId: 'uB', postAsUserId: null }),
    })
    expect(h.postAsUser).not.toHaveBeenCalled()
    expect(h.postSystem).toHaveBeenCalledTimes(1)
  })
})

describe('the answer, in the same DM', () => {
  it('no offer was posted there: nothing is said', async () => {
    expect(await postTradeStatusToDm({ source: 'native', tradeId: 'trade-9', status: 'accepted' })).toEqual({ posted: false, reason: 'no_offer_in_dm' })
    expect(h.postSystem).not.toHaveBeenCalled()
  })

  it('🛑 said ONCE per status, and the card stops saying "Pending"', async () => {
    await postTradeOfferToDm({ source: 'native', tradeId: 'trade-1', load: loadCard })
    const first = await postTradeStatusToDm({ source: 'native', tradeId: 'trade-1', status: 'accepted', actorUserId: 'uB' })
    const again = await postTradeStatusToDm({ source: 'native', tradeId: 'trade-1', status: 'accepted', actorUserId: 'uB' })
    expect(first).toEqual({ posted: true, threadId: 'dm-1', messageId: 'status-msg' })
    expect(again).toEqual({ posted: false, reason: 'already_posted' })
    expect(h.postSystem).toHaveBeenCalledTimes(1)
    expect(h.postSystem).toHaveBeenCalledWith('dm-1', 'text', 'Bob accepted the trade.', {
      tradeOfferStatus: { source: 'native', tradeId: 'trade-1', status: 'accepted', href: CARD.href },
    })
    const card = (h.messages.get('offer-msg')!.metadata as { tradeOffer: TradeOfferCard }).tradeOffer
    expect(card.status).toBe('accepted')
  })
})

describe('queueTradeStatusInDm — the one-line hook for a route that answers an offer', () => {
  it('returns at once and posts the status in the background', async () => {
    await postTradeOfferToDm({ source: 'native', tradeId: 'trade-1', load: loadCard })
    expect(queueTradeStatusInDm({ source: 'native', tradeId: 'trade-1', status: 'rejected', actorUserId: 'uB' })).toBeUndefined()
    await vi.waitFor(() => expect(h.postSystem).toHaveBeenCalledWith('dm-1', 'text', 'Bob declined the trade.', expect.anything()))
  })

  it('never throws, even when the post itself blows up', async () => {
    await postTradeOfferToDm({ source: 'native', tradeId: 'trade-1', load: loadCard })
    h.postSystem.mockRejectedValue(new Error('chat down'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => queueTradeStatusInDm({ source: 'native', tradeId: 'trade-1', status: 'cancelled' })).not.toThrow()
    await vi.waitFor(() => expect(errors).toHaveBeenCalled())
    errors.mockRestore()
  })
})

describe('card loaders', () => {
  it('native: two teams, names, what each side gives, the offer note and the trade link', async () => {
    h.trade = {
      id: 'trade-1',
      leagueId: 'L1',
      proposedByUserId: 'uA',
      proposerRosterId: 'rA',
      receiverRosterId: 'rB',
      metadata: { offerMessage: '  Fair for both of us?  ' },
      createdAt: new Date('2026-09-25T18:00:00Z'),
      items: [
        { itemType: 'player', itemReference: 'p1', fromRosterId: 'rA', toRosterId: 'rB', faabAmount: null, metadata: { playerName: 'Nico Collins', position: 'WR', team: 'HOU' } },
        { itemType: 'player', itemReference: 'p2', fromRosterId: 'rB', toRosterId: 'rA', faabAmount: null, metadata: {} },
        { itemType: 'rookie_pick', itemReference: 'x', fromRosterId: 'rA', toRosterId: 'rB', faabAmount: null, metadata: { pickSeason: 2027, pickRound: 1 } },
        { itemType: 'faab', itemReference: null, fromRosterId: 'rB', toRosterId: 'rA', faabAmount: 15, metadata: {} },
      ],
    }
    h.rosters = [{ id: 'rA', platformUserId: 'uA' }, { id: 'rB', platformUserId: 'uB' }]
    const loaded = await loadNativeTradeOffer('trade-1')
    expect(loaded).toMatchObject({ proposerUserId: 'uA', receiverUserId: 'uB', postAsUserId: 'uA' })
    expect(loaded!.card).toMatchObject({
      source: 'native',
      leagueName: 'Pirate League',
      note: 'Fair for both of us?',
      href: '/league/L1?view=trades&tradeId=trade-1',
      proposer: {
        manager: 'Dana',
        team: 'Dana Dynasty',
        gives: [{ label: 'Nico Collins', detail: 'WR · HOU' }, { label: '2027 Round 1 pick' }],
      },
      receiver: { gives: [{ label: 'C.J. Stroud', detail: 'QB · HOU' }, { label: '$15 FAAB' }] },
    })
    // Bob's display name is an address in this fixture: never on the card.
    expect(loaded!.card.receiver.manager).toBe('uB_user')
  })

  it('native: a three-team trade has no single DM and is skipped', async () => {
    h.trade = {
      id: 't3', leagueId: 'L1', proposedByUserId: 'uA', proposerRosterId: 'rA', receiverRosterId: 'rB', metadata: {}, createdAt: new Date(),
      items: [
        { itemType: 'player', itemReference: 'p1', fromRosterId: 'rA', toRosterId: 'rB', faabAmount: null, metadata: {} },
        { itemType: 'player', itemReference: 'p2', fromRosterId: 'rC', toRosterId: 'rA', faabAmount: null, metadata: {} },
      ],
    }
    expect(await loadNativeTradeOffer('t3')).toBeNull()
  })

  it('native on an imported league: the receiver roster carries a Sleeper id, resolved to the account', async () => {
    h.trade = {
      id: 't4', leagueId: 'L1', proposedByUserId: 'uA', proposerRosterId: 'rA', receiverRosterId: 'rB', metadata: {}, createdAt: new Date(),
      items: [{ itemType: 'player', itemReference: 'p1', fromRosterId: 'rA', toRosterId: 'rB', faabAmount: null, metadata: { playerName: 'X' } }],
    }
    h.rosters = [{ id: 'rA', platformUserId: 'sl-A' }, { id: 'rB', platformUserId: 'sl-B' }]
    h.profilesBySleeperId.set('sl-B', 'uB')
    expect((await loadNativeTradeOffer('t4'))?.receiverUserId).toBe('uB')
  })

  it('redraft: owners are the two managers; the proposal reason is the note', async () => {
    h.redraft = {
      id: 'rp1', leagueId: 'L1', proposerRosterId: 'r1', receiverRosterId: 'r2', reason: 'You need a QB', createdAt: new Date(),
      assets: [
        { fromRosterId: 'r1', toRosterId: 'r2', assetType: 'player', playerName: 'Nico Collins', pickSeason: null, pickRound: null, metadata: {} },
        { fromRosterId: 'r2', toRosterId: 'r1', assetType: 'draft_pick', playerName: null, pickSeason: 2027, pickRound: 2, metadata: {} },
        { fromRosterId: 'r2', toRosterId: 'r1', assetType: 'faab', playerName: null, pickSeason: null, pickRound: null, metadata: { amount: 7 } },
      ],
    }
    h.redraftRosters = [
      { id: 'r1', ownerId: 'uA', ownerName: 'dana@example.org', teamName: 'Dana Dynasty' },
      { id: 'r2', ownerId: 'uB', ownerName: 'Bob', teamName: null },
    ]
    const loaded = await loadRedraftTradeOffer('rp1')
    expect(loaded).toMatchObject({ proposerUserId: 'uA', receiverUserId: 'uB' })
    expect(loaded!.card).toMatchObject({
      source: 'redraft',
      note: 'You need a QB',
      href: '/league/L1?view=trades',
      proposer: { gives: [{ label: 'Nico Collins' }] },
      receiver: { gives: [{ label: '2027 Round 2 pick' }, { label: '$7 FAAB' }] },
    })
  })

  it('draft pick: each side gives one pick, linked to the draft room', async () => {
    h.draftProposal = { id: 'dp1', giveRound: 3, giveSlot: 5, receiveRound: 2, receiveSlot: 9, proposerName: 'Dana', receiverName: 'Bob', createdAt: new Date() }
    h.draftRoster = { platformUserId: 'uB' }
    const loaded = await loadDraftPickTradeOffer({ leagueId: 'L1', proposalId: 'dp1', proposerUserId: 'uA', receiverRosterId: 'rB' })
    expect(loaded!.card).toMatchObject({
      source: 'draft_pick',
      href: '/league/L1?tab=Draft',
      proposer: { gives: [{ label: 'Round 3, pick 5' }] },
      receiver: { gives: [{ label: 'Round 2, pick 9' }] },
    })
  })

  it('imported: each manager gets their own league link, and a non-user is never messaged', async () => {
    const r = await postImportedOfferToDm({
      provider: 'sleeper',
      providerLeagueId: 'SL1',
      transactionId: 'T1',
      leagueId: 'af-A',
      leagueName: 'Pirate League',
      proposer: { userId: 'uA', manager: 'Dana', gives: [{ label: 'Nico Collins' }], href: '/core/trades?league=af-A&trade=T1' },
      receiver: { userId: 'uB', manager: 'Bob', gives: [{ label: 'C.J. Stroud' }], href: '/core/trades?league=af-B&trade=T1' },
      directionKnown: true,
    })
    expect(r.posted).toBe(true)
    const meta = h.postAsUser.mock.calls[0][4] as { tradeOffer: TradeOfferCard }
    expect(meta.tradeOffer).toMatchObject({
      source: 'sleeper',
      tradeId: 'SL1:T1',
      answerOn: 'sleeper',
      hrefs: { uA: '/core/trades?league=af-A&trade=T1', uB: '/core/trades?league=af-B&trade=T1' },
    })
  })
})

describe('Yahoo offers read by the Trades panel', () => {
  const yahooTrade = {
    transactionId: '449.l.77.tr.12',
    proposedBy: 'Team 4',
    proposedByViewer: false,
    proposedAt: '2026-09-25T17:00:00.000Z',
    assetsGiven: [{ playerId: 'y1', playerName: 'Nico Collins', position: 'WR', team: 'HOU' }],
    assetsReceived: [{ playerId: 'y2', playerName: 'C.J. Stroud', position: 'QB', team: 'HOU' }],
    readOnly: true as const,
    provider: 'yahoo' as const,
    viewerRosterExternalId: '449.l.77.t.1',
    counterpartyRosterExternalId: '449.l.77.t.4',
  }

  it('the other team\'s manager is on AllFantasy (their own league copy): posted once, direction-neutral, as a system message', async () => {
    h.yahooTheirs = { claimedByUserId: 'uB', teamName: 'Bob Squad', leagueId: 'af-B' }
    const [first] = await postYahooOffersToDms({ leagueId: 'af-A', platformLeagueId: '449.l.77', viewerUserId: 'uA', trades: [yahooTrade] })
    expect(first.posted).toBe(true)
    expect(h.postSystem).toHaveBeenCalledTimes(1)
    const meta = h.postSystem.mock.calls[0][3] as { tradeOffer: TradeOfferCard }
    expect(meta.tradeOffer).toMatchObject({
      source: 'yahoo',
      tradeId: '449.l.77:449.l.77.tr.12',
      directionKnown: false,
      answerOn: 'yahoo',
      hrefs: { uA: '/league/af-A?view=trades', uB: '/league/af-B?view=trades' },
      proposer: { manager: 'Dana Dynasty', gives: [{ label: 'Nico Collins', detail: 'WR · HOU' }] },
      receiver: { manager: 'Bob Squad', gives: [{ label: 'C.J. Stroud', detail: 'QB · HOU' }] },
    })
    // Every later panel view is a no-op.
    const [again] = await postYahooOffersToDms({ leagueId: 'af-A', platformLeagueId: '449.l.77', viewerUserId: 'uA', trades: [yahooTrade] })
    expect(again).toEqual({ posted: false, reason: 'already_posted' })
  })

  it('🛑 the other team is not claimed by anyone on AllFantasy: nothing is posted', async () => {
    const [r] = await postYahooOffersToDms({ leagueId: 'af-A', platformLeagueId: '449.l.77', viewerUserId: 'uA', trades: [yahooTrade] })
    expect(r).toEqual({ posted: false, reason: 'no_card' })
    expect(h.createThread).not.toHaveBeenCalled()
    expect(h.postSystem).not.toHaveBeenCalled()
  })
})
