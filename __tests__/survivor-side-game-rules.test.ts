// @vitest-environment node
/**
 * Exile Island and the side games — the pure rules (lib/survivor/survivorSideGameRules.ts), the
 * settings reader and validator, the ledger fold, the Exile lineup slot override and the
 * same-position test behind the free-trade-token bypass.
 */
import { describe, expect, it } from 'vitest'
import {
  applyPoolOutcome,
  bidRefusal,
  chimmyAuctionBid,
  chimmySideGamePick,
  chunkFaab,
  easternDayTimeOnOrAfter,
  EMPTY_POOL_ENTRY,
  exileReturnFaab,
  foldSideGameRows,
  pickOutcome,
  poolBanned,
  poolPickRefusal,
  poolRevivesLeft,
  resolveAuction,
  resolveExileTeamBids,
  revivePoolEntry,
  seasonRecords,
  settleTokenPoolPick,
  shopPurchaseRefusal,
  sideGameTeamKey,
  sideGameWinnerKey,
} from '@/lib/survivor/survivorSideGameRules'
import {
  DEFAULT_TOKEN_SHOP_ITEMS,
  readSurvivorSideGameSettings,
  survivorPoolRuleForWeek,
  SURVIVOR_SIDE_GAME_DEFAULTS,
  validateSurvivorSideGamePatch,
  lockedSideGameKeys,
} from '@/lib/survivor/survivorSideGameSettings'
import { foldSideGameLedger, SIDE_GAME_ACTIONS, visibleAuctionItems } from '@/lib/survivor/survivorSideGameLedger'
import { addExilePlayer, dropExilePlayer, emptyExileRoster, exileSlotConfig } from '@/lib/survivor/exileRosterRules'
import { isSamePositionTrade } from '@/lib/survivor/survivorFreeTradeTokenBypass'

const T0 = new Date('2026-10-04T17:00:00Z')
const game = (home: string, away: string, opts: Partial<{ start: Date; final: boolean; hs: number; as: number }> = {}) => ({
  homeTeam: home, awayTeam: away, startTime: opts.start ?? T0, final: opts.final ?? false, homeScore: opts.hs ?? null, awayScore: opts.as ?? null,
})

describe('teams and games from stored finals', () => {
  it('folds NFL full names, abbreviations and old spellings onto one key', () => {
    expect(sideGameTeamKey('NFL', 'Kansas City Chiefs')).toBe('KC')
    expect(sideGameTeamKey('NFL', 'jac')).toBe('JAX')
    expect(sideGameTeamKey('NFL', 'Oakland Raiders')).toBe('LV')
    expect(sideGameTeamKey('NBA', 'Montréal  Canadiens')).toBe('MONTREAL CANADIENS')
  })

  it('merges two feeds of one game, and a final needs both halves of the score', () => {
    const [g] = foldSideGameRows('NFL', [
      { ...game('Kansas City Chiefs', 'BUF'), final: true, homeScore: 24, awayScore: null },
      { ...game('KC', 'Buffalo Bills'), final: true, homeScore: 24, awayScore: 20 },
    ])
    expect(g.key).toBe('BUF@KC')
    expect(sideGameWinnerKey(g)).toBe('KC')
  })

  it('two finals that disagree never settle on a guess', () => {
    const [g] = foldSideGameRows('NFL', [
      { ...game('KC', 'BUF'), final: true, homeScore: 24, awayScore: 20 },
      { ...game('KC', 'BUF'), final: true, homeScore: 17, awayScore: 20 },
    ])
    expect(g.conflicting).toBe(true)
    expect(sideGameWinnerKey(g)).toBeNull()
  })

  it('a tie is a push, not a loss', () => {
    const [g] = foldSideGameRows('NFL', [{ ...game('KC', 'BUF'), final: true, homeScore: 20, awayScore: 20 }])
    expect(sideGameWinnerKey(g)).toBe('tie')
    expect(pickOutcome('KC', 'tie')).toBe('push')
    expect(pickOutcome('KC', 'KC')).toBe('correct')
    expect(pickOutcome('BUF', 'KC')).toBe('wrong')
  })
})

describe('Token Pool', () => {
  it('per pick: +1 right; a miss costs nothing, one token, or every token', () => {
    expect(settleTokenPoolPick({ mode: 'per_pick', wrongPick: 'keep', outcome: 'correct', balance: 3, pot: 0 })).toEqual({ balanceDelta: 1, potAfter: 0, lostAll: false })
    expect(settleTokenPoolPick({ mode: 'per_pick', wrongPick: 'keep', outcome: 'wrong', balance: 3, pot: 0 }).balanceDelta).toBe(0)
    expect(settleTokenPoolPick({ mode: 'per_pick', wrongPick: 'minus_one', outcome: 'wrong', balance: 3, pot: 0 }).balanceDelta).toBe(-1)
    expect(settleTokenPoolPick({ mode: 'per_pick', wrongPick: 'minus_one', outcome: 'wrong', balance: 0, pot: 0 }).balanceDelta).toBe(0)
    expect(settleTokenPoolPick({ mode: 'per_pick', wrongPick: 'lose_all', outcome: 'wrong', balance: 5, pot: 0 })).toEqual({ balanceDelta: -5, potAfter: 0, lostAll: true })
  })

  it('streak: right builds the pot, wrong loses it (and with lose_all the bank too), a tie changes nothing', () => {
    expect(settleTokenPoolPick({ mode: 'streak', wrongPick: 'keep', outcome: 'correct', balance: 2, pot: 2 })).toEqual({ balanceDelta: 0, potAfter: 3, lostAll: false })
    expect(settleTokenPoolPick({ mode: 'streak', wrongPick: 'keep', outcome: 'wrong', balance: 2, pot: 3 })).toEqual({ balanceDelta: 0, potAfter: 0, lostAll: false })
    expect(settleTokenPoolPick({ mode: 'streak', wrongPick: 'lose_all', outcome: 'wrong', balance: 2, pot: 3 })).toEqual({ balanceDelta: -2, potAfter: 0, lostAll: true })
    expect(settleTokenPoolPick({ mode: 'streak', wrongPick: 'lose_all', outcome: 'push', balance: 2, pot: 3 })).toEqual({ balanceDelta: 0, potAfter: 3, lostAll: false })
  })
})

describe('Survivor Pool', () => {
  const g = { homeKey: 'KC', awayKey: 'BUF' }
  it('rules: any, away only, conference, allowed list', () => {
    expect(poolPickRefusal('NFL', { rule: 'any', conference: 'AFC', allowedTeams: [] }, g, 'KC')).toBeNull()
    expect(poolPickRefusal('NFL', { rule: 'away_only', conference: 'AFC', allowedTeams: [] }, g, 'KC')).toBe('not_away')
    expect(poolPickRefusal('NFL', { rule: 'away_only', conference: 'AFC', allowedTeams: [] }, g, 'BUF')).toBeNull()
    expect(poolPickRefusal('NFL', { rule: 'conference', conference: 'NFC', allowedTeams: [] }, g, 'KC')).toBe('not_in_conference')
    expect(poolPickRefusal('NFL', { rule: 'conference', conference: 'AFC', allowedTeams: [] }, g, 'KC')).toBeNull()
    expect(poolPickRefusal('NFL', { rule: 'allowed_list', conference: 'AFC', allowedTeams: ['Kansas City Chiefs', 'TB'] }, g, 'KC')).toBeNull()
    expect(poolPickRefusal('NFL', { rule: 'allowed_list', conference: 'AFC', allowedTeams: ['TB'] }, g, 'KC')).toBe('not_allowed')
    expect(poolPickRefusal('NFL', { rule: 'any', conference: 'AFC', allowedTeams: [] }, g, 'DAL')).toBe('not_in_game')
  })

  it('a weekly variant overrides the season rule for that week only', () => {
    const s = readSurvivorSideGameSettings({ survivorSideGames: { survivorPoolRule: 'conference', survivorPoolConference: 'AFC', survivorPoolWeekRules: [{ week: 5, rule: 'away_only' }] } })
    expect(survivorPoolRuleForWeek(s, 5).rule).toBe('away_only')
    expect(survivorPoolRuleForWeek(s, 6)).toMatchObject({ rule: 'conference', conference: 'AFC' })
  })

  it('wrong is out, revives bring you back, and with none left you are banned', () => {
    let e = applyPoolOutcome(EMPTY_POOL_ENTRY, 'correct', 1)
    expect(e.wins).toBe(1)
    e = applyPoolOutcome(e, 'wrong', 2)
    expect(e).toMatchObject({ alive: false, eliminatedWeek: 2 })
    expect(poolRevivesLeft(e, 2)).toBe(2)
    e = revivePoolEntry(e, 2)!
    expect(e).toMatchObject({ alive: true, revivesUsed: 1 })
    e = revivePoolEntry(applyPoolOutcome(e, 'wrong', 3), 2)!
    e = applyPoolOutcome(e, 'wrong', 4)
    expect(poolBanned(e, 2)).toBe(true)
    expect(revivePoolEntry(e, 2)).toBeNull()
    // The commissioner's extra revive lifts the ban.
    expect(poolBanned({ ...e, revivesGranted: 1 }, 2)).toBe(false)
  })
})

describe('auctions', () => {
  it('highest wins, a tie goes to the EARLIER bid, an unaffordable bidder is skipped', () => {
    const bids = [
      { itemId: 'item1', rosterId: 'r2', amount: 30, at: '2026-10-01T10:05:00Z' },
      { itemId: 'item1', rosterId: 'r1', amount: 30, at: '2026-10-01T10:00:00Z' },
      { itemId: 'item2', rosterId: 'r1', amount: 50, at: '2026-10-01T10:01:00Z' },
      { itemId: 'item2', rosterId: 'r3', amount: 10, at: '2026-10-01T10:02:00Z' },
    ]
    const awards = resolveAuction(['item1', 'item2'], bids, new Map([['r1', 60], ['r2', 100], ['r3', 10]]))
    // r1 wins item1 on the earlier bid, then cannot afford 50 more of its 60, so r3 takes item2.
    expect(awards).toEqual([{ itemId: 'item1', rosterId: 'r1', amount: 30 }, { itemId: 'item2', rosterId: 'r3', amount: 10 }])
  })

  it('sealed bids lock; open bids must beat the high bid; never over balance', () => {
    const mine = { itemId: 'i', rosterId: 'r1', amount: 5, at: 'x' }
    expect(bidRefusal({ mode: 'sealed', amount: 9, balance: 50, mine, high: mine })).toBe('locked')
    expect(bidRefusal({ mode: 'sealed', amount: 9, balance: 50, mine: null, high: mine })).toBeNull()
    expect(bidRefusal({ mode: 'open', amount: 5, balance: 50, mine: null, high: mine })).toBe('too_low')
    expect(bidRefusal({ mode: 'open', amount: 6, balance: 50, mine: null, high: mine })).toBeNull()
    expect(bidRefusal({ mode: 'open', amount: 60, balance: 50, mine: null, high: null })).toBe('over_balance')
    expect(bidRefusal({ mode: 'open', amount: 1.5, balance: 50, mine: null, high: null })).toBe('not_whole')
  })

  it('a blind item stays a mystery until the auction closes', () => {
    const a = { auctionId: 'a', label: 'A', mode: 'sealed' as const, currency: 'faab' as const, opensAt: '', closesAt: '', week: 3, items: [{ itemId: 'item1', label: 'Vote Steal', blind: true, prize: { kind: 'advantage' as const, amount: 0, powerType: 'vote_steal' as const, samePositionOnly: false } }], status: 'open' as const, bids: [], awards: [], cashGranted: false }
    expect(visibleAuctionItems(a)[0]).toMatchObject({ label: 'Mystery item', prizeKind: null })
    expect(visibleAuctionItems(a, 'es')[0].label).toBe('Artículo misterioso')
    expect(visibleAuctionItems({ ...a, status: 'settled' })[0]).toMatchObject({ label: 'Vote Steal', prizeKind: 'advantage' })
  })
})

describe('Exile team bids', () => {
  it('each team to its best bid, ties to the earlier bid, nobody wins two', () => {
    const awards = resolveExileTeamBids('NFL', [
      { userId: 'a', team: 'KC', amount: 40, at: '2026-10-01T10:00:00Z' },
      { userId: 'b', team: 'Kansas City Chiefs', amount: 40, at: '2026-10-01T09:00:00Z' },
      { userId: 'b', team: 'BUF', amount: 39, at: '2026-10-01T09:30:00Z' },
      { userId: 'a', team: 'BUF', amount: 10, at: '2026-10-01T10:30:00Z' },
    ])
    expect(awards).toEqual([{ userId: 'b', team: 'KANSAS CITY CHIEFS', amount: 40 }, { userId: 'a', team: 'BUF', amount: 10 }])
  })

  it('closes at the first Eastern day/time on or after the period start', () => {
    // Tuesday 2026-10-06 00:00 ET → Wednesday 21:00 ET = Thursday 01:00 UTC (EDT).
    const close = easternDayTimeOnOrAfter(new Date('2026-10-06T04:00:00Z'), 'Wednesday', '21:00')
    expect(close.toISOString()).toBe('2026-10-08T01:00:00.000Z')
  })
})

describe('Exile return FAAB', () => {
  it('rate 0 pays nothing (today), all vs leftover, chunked to the reward limit', () => {
    expect(exileReturnFaab({ rate: 0, basis: 'all', held: 9, required: 3 })).toBe(0)
    expect(exileReturnFaab({ rate: 50, basis: 'all', held: 9, required: 3 })).toBe(450)
    expect(exileReturnFaab({ rate: 50, basis: 'leftover', held: 9, required: 3 })).toBe(300)
    expect(chunkFaab(2300)).toEqual([1000, 1000, 300])
    expect(chunkFaab(0)).toEqual([])
  })
})

describe('Exile lineup slots set by the commissioner', () => {
  const qb = { id: 'q', name: 'QB', position: 'QB', team: 'KC' }
  const wr = { id: 'w1', name: 'WR1', position: 'WR', team: 'KC' }
  const wr2 = { id: 'w2', name: 'WR2', position: 'WR', team: 'KC' }
  it('default: the main league slots (today)', () => {
    const c = exileSlotConfig('NFL', {})
    expect(c.starterCapacities.get('QB')).toBe(1)
    expect(c.benchSlots).toBeGreaterThan(0)
  })
  it('QB RB WR TE W/R/T: one of each, the flex takes the second WR, no bench', () => {
    const settings = { survivorSideGames: { exileLineupSlots: ['QB', 'RB', 'WR', 'TE', 'W/R/T'] } }
    const c = exileSlotConfig('NFL', settings)
    expect([...c.starterCapacities]).toEqual([['QB', 1], ['RB', 1], ['WR', 1], ['TE', 1], ['FLX', 1]])
    expect(c.benchSlots).toBe(0)
    let r = addExilePlayer(emptyExileRoster(), qb, 'NFL', settings, [])
    r = addExilePlayer(r, wr, 'NFL', settings, [])
    r = addExilePlayer(r, wr2, 'NFL', settings, [])
    expect(r.players.map((p) => p.slot)).toEqual(['QB', 'WR', 'FLX'])
    expect(() => addExilePlayer(r, { id: 'w3', name: 'WR3', position: 'WR', team: 'KC' }, 'NFL', settings, [])).toThrow('eligible roster slot')
  })
  it('a team won in the bidding is the only team the winner may claim from, and survives dropping the anchor', () => {
    const won = { ...emptyExileRoster(), team: 'KC', awardedTeam: 'KC' }
    expect(() => addExilePlayer(won, { ...qb, team: 'BUF' }, 'NFL', {}, [])).toThrow('You won KC')
    const r = addExilePlayer(won, qb, 'NFL', {}, [])
    expect(dropExilePlayer(r, 'q')).toMatchObject({ team: 'KC', awardedTeam: 'KC', players: [] })
  })
})

describe('Chimmy plays deterministically', () => {
  const finals = foldSideGameRows('NFL', [
    { ...game('KC', 'BUF', { start: new Date('2026-09-20T17:00:00Z') }), final: true, homeScore: 30, awayScore: 10 },
    { ...game('KC', 'DEN', { start: new Date('2026-09-27T17:00:00Z') }), final: true, homeScore: 30, awayScore: 10 },
  ])
  const records = seasonRecords(finals)
  const week = foldSideGameRows('NFL', [
    game('NYJ', 'KC', { start: new Date('2026-10-04T20:00:00Z') }),
    game('MIA', 'NE', { start: new Date('2026-10-04T17:00:00Z') }),
  ])
  it('picks the stored-data favourite with the biggest edge, and the same pick every time', () => {
    const pick = chimmySideGamePick(week, records, new Date('2026-10-04T12:00:00Z'))
    expect(pick).toEqual({ gameKey: 'KC@NYJ', teamKey: 'KC' })
    expect(chimmySideGamePick(week, records, new Date('2026-10-04T12:00:00Z'))).toEqual(pick)
  })
  it('respects the pool rule and skips locked games', () => {
    expect(chimmySideGamePick(week, records, new Date('2026-10-04T12:00:00Z'), (g, t) => t === g.homeKey)?.teamKey).not.toBe('KC')
    expect(chimmySideGamePick(week, records, new Date('2026-10-04T21:00:00Z'))).toBeNull()
  })
  it('bids on one visible item for at most a quarter of its balance', () => {
    const items = [{ itemId: 'item1', blind: true, prizeKind: 'advantage' }, { itemId: 'item2', blind: false, prizeKind: 'faab' }, { itemId: 'item3', blind: false, prizeKind: 'free_trade_token' }]
    expect(chimmyAuctionBid({ mode: 'sealed', balance: 100, items, bids: [], rosterId: 'c' })).toEqual({ itemId: 'item3', amount: 25 })
    expect(chimmyAuctionBid({ mode: 'sealed', balance: 100, items, bids: [{ itemId: 'item3', rosterId: 'c', amount: 25, at: 'x' }], rosterId: 'c' })).toBeNull()
    expect(chimmyAuctionBid({ mode: 'open', balance: 100, items, bids: [{ itemId: 'item3', rosterId: 'x', amount: 24, at: 'x' }], rosterId: 'c' })).toEqual({ itemId: 'item3', amount: 25 })
    expect(chimmyAuctionBid({ mode: 'open', balance: 100, items, bids: [{ itemId: 'item3', rosterId: 'x', amount: 25, at: 'x' }], rosterId: 'c' })).toBeNull()
    expect(chimmyAuctionBid({ mode: 'sealed', balance: 3, items, bids: [], rosterId: 'c' })).toBeNull()
  })
})

describe('settings', () => {
  it('defaults keep every existing league as it was', () => {
    const s = readSurvivorSideGameSettings({})
    expect(s).toEqual(SURVIVOR_SIDE_GAME_DEFAULTS)
    expect(s.exileTokenFaabRate).toBe(0)
    expect(s.exileClaimMode).toBe('first_come')
    expect(s.tokenShopItems.every((i) => !i.enabled)).toBe(true)
    expect(s.survivorPoolEnabled).toBe(false)
    expect(s.hideExileMembership).toBe(false)
  })
  it('the old harsh-loss column still means minus one until the commissioner chooses', () => {
    expect(readSurvivorSideGameSettings({}, { harshTokenLoss: true }).tokenPoolWrongPick).toBe('minus_one')
    expect(readSurvivorSideGameSettings({ survivorSideGames: { tokenPoolWrongPick: 'lose_all' } }, { harshTokenLoss: true }).tokenPoolWrongPick).toBe('lose_all')
  })
  it('validates a patch: normalises slots, refuses unknown keys and junk, honours locks', () => {
    const ok = validateSurvivorSideGamePatch(SURVIVOR_SIDE_GAME_DEFAULTS, { exileLineupSlots: ['qb', 'w/r/t'], exileTokenFaabRate: 50 })
    expect(ok.ok && ok.settings.exileLineupSlots).toEqual(['QB', 'FLX'])
    expect(validateSurvivorSideGamePatch(SURVIVOR_SIDE_GAME_DEFAULTS, { nope: 1 })).toMatchObject({ ok: false, code: 'invalid' })
    expect(validateSurvivorSideGamePatch(SURVIVOR_SIDE_GAME_DEFAULTS, { exileTokenFaabRate: 9999 })).toMatchObject({ ok: false, code: 'invalid' })
    const locked = lockedSideGameKeys({ draftStarted: true, seasonStarted: true })
    expect(validateSurvivorSideGamePatch(SURVIVOR_SIDE_GAME_DEFAULTS, { exileTokenFaabRate: 50 }, locked)).toMatchObject({ ok: false, code: 'locked' })
    // Start/stop and prices stay editable all season.
    expect(validateSurvivorSideGamePatch(SURVIVOR_SIDE_GAME_DEFAULTS, { tokenPoolOpen: false }, locked).ok).toBe(true)
    expect(validateSurvivorSideGamePatch(SURVIVOR_SIDE_GAME_DEFAULTS, { survivorPoolEnabled: true, survivorPoolPrize: { kind: 'faab', amount: 0 } })).toMatchObject({ ok: false })
  })
  it('the shop sells only what the commissioner enabled', () => {
    const item = { ...DEFAULT_TOKEN_SHOP_ITEMS[0], enabled: true }
    expect(shopPurchaseRefusal({ shopEnabled: false, item, balance: 10 })).toBe('shop_closed')
    expect(shopPurchaseRefusal({ shopEnabled: true, item: DEFAULT_TOKEN_SHOP_ITEMS[0], balance: 10 })).toBe('not_for_sale')
    expect(shopPurchaseRefusal({ shopEnabled: true, item, balance: item.cost - 1 })).toBe('not_enough_tokens')
    expect(shopPurchaseRefusal({ shopEnabled: true, item, balance: item.cost })).toBeNull()
  })
})

describe('ledger fold', () => {
  const row = (action: string, entity: string, data: Record<string, unknown>, at = '2026-10-01T00:00:00Z') => ({ action, relatedEntityId: entity, data, createdAt: at })
  it('folds picks, settlements, cash-outs, revives, cash and keys', () => {
    const s = foldSideGameLedger([
      row(SIDE_GAME_ACTIONS.tokenPoolPick, 'tokenpool:u1', { key: 'k1', pickId: 'p1', week: 3, gameKey: 'BUF@KC', teamKey: 'KC' }),
      row(SIDE_GAME_ACTIONS.tokenPoolSettled, 'tokenpool:u1', { key: 'k2', pickId: 'p1', outcome: 'correct', potAfter: 1 }),
      row(SIDE_GAME_ACTIONS.tokenPoolCashOut, 'tokenpool:u1', { key: 'k3', amount: 1 }),
      row(SIDE_GAME_ACTIONS.poolPick, 'pool:u2', { key: 'k4', week: 3, gameKey: 'BUF@KC', teamKey: 'BUF' }),
      row(SIDE_GAME_ACTIONS.poolPick, 'pool:u2', { key: 'k5', week: 3, gameKey: 'BUF@KC', teamKey: 'KC' }),
      row(SIDE_GAME_ACTIONS.poolSettled, 'pool:u2', { key: 'k6', week: 3, outcome: 'correct', entry: { alive: true, revivesUsed: 0, revivesGranted: 0, eliminatedWeek: null, wins: 1 } }),
      row(SIDE_GAME_ACTIONS.cashCredit, 'cash:r1', { key: 'k7', amount: 50 }),
      row(SIDE_GAME_ACTIONS.cashDebit, 'cash:r1', { key: 'k8', amount: 80 }),
    ])
    expect(s.tokenPool.get('u1')).toMatchObject({ pot: 0, picks: [{ outcome: 'correct' }] })
    expect(s.pool.get('u2')?.picks).toHaveLength(1)
    expect(s.pool.get('u2')?.picks[0]).toMatchObject({ teamKey: 'KC', outcome: 'correct' })
    expect(s.pool.get('u2')?.entry.wins).toBe(1)
    expect(s.cash.get('r1')).toBe(0)
    expect([...s.keys]).toHaveLength(8)
  })
  it('folds an auction: creation, bids (an open raise replaces), settlement', () => {
    const s = foldSideGameLedger([
      row(SIDE_GAME_ACTIONS.auctionCreated, 'auction:a1', { key: 'a', auction: { label: 'Week 6', mode: 'open', currency: 'faab', opensAt: 'o', closesAt: 'c', week: 6, items: [] } }),
      row(SIDE_GAME_ACTIONS.auctionBid, 'auction:a1', { key: 'b1', itemId: 'item1', rosterId: 'r1', amount: 5 }),
      row(SIDE_GAME_ACTIONS.auctionBid, 'auction:a1', { key: 'b2', itemId: 'item1', rosterId: 'r1', amount: 9 }),
      row(SIDE_GAME_ACTIONS.auctionSettled, 'auction:a1', { key: 's', awards: [{ itemId: 'item1', rosterId: 'r1', amount: 9 }] }),
    ])
    expect(s.auctions.get('a1')).toMatchObject({ status: 'settled', mode: 'open', bids: [{ amount: 9 }], awards: [{ amount: 9 }] })
  })
})

describe('same-position trade (the samePositionOnly free trade)', () => {
  it('two sides, the same positions in the same numbers', () => {
    expect(isSamePositionTrade([{ fromRosterId: 'a', position: 'RB' }, { fromRosterId: 'b', position: 'RB' }])).toBe(true)
    expect(isSamePositionTrade([{ fromRosterId: 'a', position: 'WR' }, { fromRosterId: 'a', position: 'TE' }, { fromRosterId: 'b', position: 'TE' }, { fromRosterId: 'b', position: 'WR' }])).toBe(true)
    expect(isSamePositionTrade([{ fromRosterId: 'a', position: 'RB' }, { fromRosterId: 'b', position: 'WR' }])).toBe(false)
    expect(isSamePositionTrade([{ fromRosterId: 'a', position: 'RB' }])).toBe(false)
    expect(isSamePositionTrade([{ fromRosterId: 'a', position: 'RB' }, { fromRosterId: 'b', position: null }])).toBe(false)
  })
})
