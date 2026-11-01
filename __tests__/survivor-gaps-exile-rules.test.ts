// @vitest-environment node
/**
 * Exile Island and the side games — the gaps closed in G3, pure logic: Chimmy's sealed Exile team
 * bid, Survivor Pool conference/division rules for every sport (stored team data), the tie and
 * missed-pick rules, no reusing a team, auction refunds, disadvantages, the free-trade-token
 * override, Exile secrecy and "removed if exposed", the legacy Token Pool bridge and the setup
 * screen's side-game block (one shared validator).
 */
import { describe, expect, it } from 'vitest'
import {
  applyMissedPoolPick,
  auctionRefundDue,
  chimmyExileTeamBid,
  disadvantageTargets,
  EMPTY_POOL_ENTRY,
  pickChimmyDisadvantageTarget,
  poolOutcomeWithTieRule,
  poolPickRefusal,
  poolReuseRefusal,
  poolUsedTeams,
  poolWeekLocked,
  teamGroupChoices,
  teamGroupOf,
  teamGroupsFromRows,
} from '@/lib/survivor/survivorSideGameRules'
import {
  readSurvivorSideGameSettings,
  SURVIVOR_SIDE_GAME_DEFAULTS,
  survivorPoolRuleForWeek,
  validateSurvivorSideGamePatch,
  auctionPrizeDisadvantageError,
} from '@/lib/survivor/survivorSideGameSettings'
import { describeSurvivorReward, rewardHolderRosterIds, rewardNeedsChoice, validateSurvivorRewardSpec } from '@/lib/survivor/survivorRewardModel'
import { survivorBypassSourceToRedeem } from '@/lib/survivor/survivorTradeRuleBypass'
import { exileExposureCheck, exilePageVisibility, exileSafeMembers, visibleExileCount } from '@/lib/survivor/survivorExileSecrecy'
import { legacyWinnerKey, mergeLegacyTokenPoolRows, resolveLegacyGameKey, sideGamePickAsLegacyRow } from '@/lib/survivor/survivorTokenPoolBridge'
import { foldSideGameLedger, auctionRefundKey } from '@/lib/survivor/survivorSideGameLedger'
import { answerSideGameRules, sideGameExileLines } from '@/lib/survivor/survivorSideGameRulesAnswers'
import { changedSideGameScreenKeys, parseSettingsForm, validateSideGameScreenValues } from '@/lib/survivor/survivorSettingsScreen'
import { formatWeekRulesText, parseWeekRulesText } from '@/lib/survivor/survivorSideGameUiMessages'
import { prizeRewardSpec } from '@/lib/survivor/survivorSideGameStore'

describe('Chimmy bids on Exile teams', () => {
  const records = new Map([['KC', { wins: 6, losses: 1 }], ['NYJ', { wins: 1, losses: 6 }], ['BUF', { wins: 4, losses: 3 }]])

  it('bids once, on the strongest open team by stored finals, budget × strength', () => {
    const bid = chimmyExileTeamBid({ sport: 'NFL', openTeams: ['NYJ', 'BUF', 'KC'], budget: 100, records, myBid: null })
    // KC: (6+1)/(7+2) = 0.777… → 78
    expect(bid).toEqual({ team: 'KC', amount: 78 })
  })

  it('never re-bids, never exceeds the budget, and needs something open', () => {
    expect(chimmyExileTeamBid({ sport: 'NFL', openTeams: ['KC'], budget: 100, records, myBid: { team: 'KC', amount: 10 } })).toBeNull()
    expect(chimmyExileTeamBid({ sport: 'NFL', openTeams: [], budget: 100, records, myBid: null })).toBeNull()
    expect(chimmyExileTeamBid({ sport: 'NFL', openTeams: ['KC'], budget: 0, records, myBid: null })).toBeNull()
    const tiny = chimmyExileTeamBid({ sport: 'NFL', openTeams: ['NYJ'], budget: 1, records, myBid: null })
    expect(tiny).toEqual({ team: 'NYJ', amount: 1 })
  })

  it('is deterministic: an unknown team ties at 0.5 and the key breaks it', () => {
    const a = chimmyExileTeamBid({ sport: 'NBA', openTeams: ['ZETA', 'ALPHA'], budget: 50, records: new Map(), myBid: null })
    expect(a).toEqual({ team: 'ALPHA', amount: 25 })
  })
})

describe('Survivor Pool conferences and divisions, every sport, from stored team data', () => {
  const rows = (sport: string) => ({
    NBA: [{ name: 'Boston Celtics', shortName: 'BOS', city: 'Boston', conference: 'Eastern', division: 'Atlantic' }, { name: 'Denver Nuggets', shortName: 'DEN', conference: 'Western', division: 'Northwest' }],
    NHL: [{ name: 'Toronto Maple Leafs', shortName: 'TOR', conference: 'Eastern', division: 'Atlantic' }, { name: 'Vegas Golden Knights', shortName: 'VGK', conference: 'Western', division: 'Pacific' }],
    MLB: [{ name: 'New York Yankees', shortName: 'NYY', conference: 'American League', division: 'AL East' }, { name: 'Los Angeles Dodgers', shortName: 'LAD', conference: 'National League', division: 'NL West' }],
    NCAAF: [{ name: 'Alabama', shortName: 'ALA', conference: 'SEC', division: null }, { name: 'Ohio State', shortName: 'OSU', conference: 'Big Ten', division: null }],
    NCAAB: [{ name: 'Duke', shortName: 'DUKE', conference: 'ACC', division: null }, { name: 'Kansas', shortName: 'KU', conference: 'Big 12', division: null }],
  } as Record<string, Array<{ name: string; shortName: string; city?: string; conference: string; division: string | null }>>)[sport]

  it.each([
    ['NBA', 'Boston Celtics', 'Denver Nuggets', 'eastern', 'atlantic'],
    ['NHL', 'Toronto Maple Leafs', 'Vegas Golden Knights', 'Eastern', 'Atlantic'],
    ['MLB', 'New York Yankees', 'Los Angeles Dodgers', 'American League', 'AL East'],
    ['NCAAF', 'Alabama', 'Ohio State', 'SEC', null],
    ['NCAAB', 'Duke', 'Kansas', 'ACC', null],
  ])('%s: the conference rule allows the conference team and refuses the other', (sport, inTeam, outTeam, conf, div) => {
    const groups = teamGroupsFromRows(sport, rows(sport))
    const key = (t: string) => teamGroupsFromRows(sport, [{ name: t, conference: 'x' }]).keys().next().value as string
    const game = { homeKey: key(inTeam), awayKey: key(outTeam) }
    const rule = { rule: 'conference' as const, conference: conf, allowedTeams: [] }
    expect(poolPickRefusal(sport, rule, game, game.homeKey, groups)).toBeNull()
    expect(poolPickRefusal(sport, rule, game, game.awayKey, groups)).toBe('not_in_conference')
    if (div) {
      const dRule = { rule: 'division' as const, conference: 'AFC', division: div, allowedTeams: [] }
      expect(poolPickRefusal(sport, dRule, game, game.homeKey, groups)).toBeNull()
      expect(poolPickRefusal(sport, dRule, game, game.awayKey, groups)).toBe('not_in_division')
    } else {
      expect(poolPickRefusal(sport, { rule: 'division', conference: 'AFC', division: 'East', allowedTeams: [] }, game, game.homeKey, groups)).toBe('division_unknown')
    }
  })

  it('NFL works with no stored rows (built-in conferences and divisions); stored rows win', () => {
    const game = { homeKey: 'KC', awayKey: 'BUF' }
    expect(poolPickRefusal('NFL', { rule: 'division', conference: 'AFC', division: 'AFC West', allowedTeams: [] }, game, 'KC')).toBeNull()
    expect(poolPickRefusal('NFL', { rule: 'division', conference: 'AFC', division: 'AFC West', allowedTeams: [] }, game, 'BUF')).toBe('not_in_division')
    expect(poolPickRefusal('NFL', { rule: 'conference', conference: 'NFC', allowedTeams: [] }, game, 'KC')).toBe('not_in_conference')
    expect(teamGroupOf('NFL', 'KC', new Map([['KC', { conference: 'AFC', division: 'AFC Wild' }]]))?.division).toBe('AFC Wild')
  })

  it('a team we know nothing about is refused, never guessed', () => {
    expect(poolPickRefusal('NBA', { rule: 'conference', conference: 'Eastern', allowedTeams: [] }, { homeKey: 'X', awayKey: 'Y' }, 'X', new Map())).toBe('conference_unknown')
  })

  it('a later feed with a blank conference never erases one another feed stored', () => {
    const g = teamGroupsFromRows('NBA', [{ name: 'Boston Celtics', conference: 'Eastern', division: null }, { name: 'Boston Celtics', conference: null, division: 'Atlantic' }])
    expect(g.get('BOSTON CELTICS')).toEqual({ conference: 'Eastern', division: 'Atlantic' })
  })

  it('offers the commissioner the stored names (deduplicated), plus the NFL built-ins', () => {
    const choices = teamGroupChoices('NBA', teamGroupsFromRows('NBA', rows('NBA')))
    expect(choices).toEqual({ conferences: ['Eastern', 'Western'], divisions: ['Atlantic', 'Northwest'] })
    expect(teamGroupChoices('NFL', null).divisions).toContain('NFC North')
  })

  it('stores any conference name, and a division rule week', () => {
    const s = readSurvivorSideGameSettings({ survivorSideGames: { survivorPoolRule: 'conference', survivorPoolConference: 'Big Ten', survivorPoolWeekRules: [{ week: 3, rule: 'division', division: 'AFC North' }] } })
    expect(s.survivorPoolConference).toBe('Big Ten')
    expect(survivorPoolRuleForWeek(s, 3)).toMatchObject({ rule: 'division', division: 'AFC North' })
    expect(parseWeekRulesText('3:division:AFC_North 4:conference:Big_Ten')).toEqual([{ week: 3, rule: 'division', division: 'AFC North' }, { week: 4, rule: 'conference', conference: 'Big Ten' }])
    expect(formatWeekRulesText([{ week: 3, rule: 'division', division: 'AFC North' }])).toBe('3:division:AFC_North')
  })
})

describe('Survivor Pool: ties, missed picks, no reusing a team', () => {
  it('the tie rule turns a push into a loss or a win; push stays the default', () => {
    expect(SURVIVOR_SIDE_GAME_DEFAULTS.survivorPoolTieRule).toBe('push')
    expect(poolOutcomeWithTieRule('push', 'push')).toBe('push')
    expect(poolOutcomeWithTieRule('push', 'loss')).toBe('wrong')
    expect(poolOutcomeWithTieRule('push', 'win')).toBe('correct')
    expect(poolOutcomeWithTieRule('wrong', 'win')).toBe('wrong')
  })

  it('a missed week: nothing, a loss, or a spent revive (out when none are left)', () => {
    expect(applyMissedPoolPick(EMPTY_POOL_ENTRY, 'none', 2, 4)).toBeNull()
    expect(applyMissedPoolPick(EMPTY_POOL_ENTRY, 'loss', 2, 4)).toMatchObject({ alive: false, eliminatedWeek: 4 })
    expect(applyMissedPoolPick(EMPTY_POOL_ENTRY, 'revive', 2, 4)).toMatchObject({ alive: true, revivesUsed: 1 })
    expect(applyMissedPoolPick({ ...EMPTY_POOL_ENTRY, revivesUsed: 2 }, 'revive', 2, 4)).toMatchObject({ alive: false, eliminatedWeek: 4 })
    expect(applyMissedPoolPick({ ...EMPTY_POOL_ENTRY, alive: false }, 'loss', 2, 4)).toBeNull()
  })

  it('a week locks for missed picks only once every game has kicked off', () => {
    const now = new Date('2026-11-01T20:00:00Z')
    expect(poolWeekLocked([], now)).toBe(false)
    expect(poolWeekLocked([{ startTime: new Date('2026-11-01T18:00:00Z'), final: false }, { startTime: new Date('2026-11-02T01:00:00Z'), final: false }], now)).toBe(false)
    expect(poolWeekLocked([{ startTime: new Date('2026-11-01T18:00:00Z'), final: false }, { startTime: null, final: true }], now)).toBe(true)
  })

  it('used teams are the OTHER weeks’ picks; the rule refuses them only when on', () => {
    const picks = [{ week: 1, teamKey: 'KC' }, { week: 2, teamKey: 'BUF' }, { week: 3, teamKey: 'DAL' }]
    expect(poolUsedTeams(picks, 3)).toEqual(['BUF', 'KC'])
    expect(poolReuseRefusal(true, ['BUF', 'KC'], 'KC')).toBe('team_used')
    expect(poolReuseRefusal(true, ['BUF', 'KC'], 'DAL')).toBeNull()
    expect(poolReuseRefusal(false, ['BUF', 'KC'], 'KC')).toBeNull()
  })

  it('these three lock at season start (they would re-judge played weeks)', () => {
    const r = validateSurvivorSideGamePatch(SURVIVOR_SIDE_GAME_DEFAULTS, { survivorPoolNoReuse: true }, ['survivorPoolNoReuse'])
    expect(r).toMatchObject({ ok: false, code: 'locked' })
  })

  it('a missed-pick ledger row folds into the entry', () => {
    const s = foldSideGameLedger([{ action: 'pool_missed', relatedEntityId: 'pool:u1', data: { key: 'poolmiss:u1:4', week: 4, entry: { alive: false, revivesUsed: 0, revivesGranted: 0, eliminatedWeek: 4, wins: 0 } }, createdAt: new Date() }])
    expect(s.pool.get('u1')?.entry).toMatchObject({ alive: false, eliminatedWeek: 4 })
  })
})

describe('Auction refunds', () => {
  it('refund only a charged, permanently failed, unrefunded prize', () => {
    expect(auctionRefundDue({ charged: 30, paid: false, permanentFailure: true, alreadyRefunded: false })).toBe(30)
    expect(auctionRefundDue({ charged: 30, paid: false, permanentFailure: false, alreadyRefunded: false })).toBe(0) // retried, not refunded
    expect(auctionRefundDue({ charged: 30, paid: false, permanentFailure: true, alreadyRefunded: true })).toBe(0)
    expect(auctionRefundDue({ charged: 30, paid: true, permanentFailure: true, alreadyRefunded: false })).toBe(0)
    expect(auctionRefundDue({ charged: 0, paid: false, permanentFailure: true, alreadyRefunded: false })).toBe(0)
  })

  it('a refund row marks its award refunded (so the runner never pays it again)', () => {
    const at = new Date('2026-11-01T00:00:00Z')
    const s = foldSideGameLedger([
      { action: 'auction_created', relatedEntityId: 'auction:a1', data: { key: 'auction:a1', auction: { label: 'A', mode: 'sealed', currency: 'faab', opensAt: at.toISOString(), closesAt: at.toISOString(), week: 3, items: [] } }, createdAt: at },
      { action: 'auction_settled', relatedEntityId: 'auction:a1', data: { key: 'auctionsettled:a1', awards: [{ itemId: 'item1', rosterId: 'r1', amount: 30, rewardId: null, paid: false }] }, createdAt: at },
      { action: 'auction_refund', relatedEntityId: 'cash:r1', data: { key: auctionRefundKey('a1', 'item1'), amount: 30, refundOf: 'a1:item1' }, createdAt: at },
    ])
    expect(s.auctions.get('a1')?.awards[0].refunded).toBe(true)
    expect(s.cash.get('r1') ?? 0).toBe(0) // a FAAB refund is not auction cash
  })

  it('an auction-cash refund is a credit that also marks the award', () => {
    const at = new Date()
    const s = foldSideGameLedger([
      { action: 'auction_created', relatedEntityId: 'auction:a2', data: { auction: { label: 'B', mode: 'sealed', currency: 'auction_cash', opensAt: '', closesAt: '', week: 3, items: [] } }, createdAt: at },
      { action: 'auction_settled', relatedEntityId: 'auction:a2', data: { awards: [{ itemId: 'item1', rosterId: 'r2', amount: 40, rewardId: null, paid: false }] }, createdAt: at },
      { action: 'cash_credit', relatedEntityId: 'cash:r2', data: { amount: 40, refundOf: 'a2:item1' }, createdAt: at },
    ])
    expect(s.cash.get('r2')).toBe(40)
    expect(s.auctions.get('a2')?.awards[0].refunded).toBe(true)
  })
})

describe('Disadvantages', () => {
  it('are reward-API specs that wait for the winner’s choice of opponent', () => {
    expect(prizeRewardSpec({ kind: 'opponent_penalty', amount: 12, powerType: 'extra_vote', samePositionOnly: false }, 'r1', 5)).toEqual({ type: 'opponent_penalty', chooserRosterId: 'r1', points: 12, targetWeek: 5 })
    expect(prizeRewardSpec({ kind: 'vote_taken', amount: 0, powerType: 'extra_vote', samePositionOnly: false }, 'r1', 5)).toEqual({ type: 'vote_taken', chooserRosterId: 'r1' })
    expect(rewardNeedsChoice({ type: 'vote_taken', chooserRosterId: 'r1' })).toBe(true)
    expect(rewardNeedsChoice({ type: 'opponent_penalty', chooserRosterId: 'r1', points: 5, targetRosterId: 'r2' })).toBe(false)
    expect(rewardHolderRosterIds({ type: 'opponent_penalty', chooserRosterId: 'r1', points: 5 })).toEqual(['r1'])
  })

  it('validate: points in range, never yourself', () => {
    expect(validateSurvivorRewardSpec({ type: 'opponent_penalty', chooserRosterId: 'r1', points: 10 })).toBeNull()
    expect(validateSurvivorRewardSpec({ type: 'opponent_penalty', chooserRosterId: 'r1', points: 0 })).toMatch(/Points/)
    expect(validateSurvivorRewardSpec({ type: 'vote_taken', chooserRosterId: 'r1', targetRosterId: 'r1' })).toMatch(/not yourself/)
  })

  it('describe themselves in English and Spanish', () => {
    expect(describeSurvivorReward({ spec: { type: 'vote_taken', chooserRosterId: 'r1' }, status: 'awaiting_choice', applyWeek: 3 })).toContain('loses their vote')
    expect(describeSurvivorReward({ spec: { type: 'opponent_penalty', chooserRosterId: 'r1', points: 8 }, status: 'applied', applyWeek: 3 }, 'es')).toContain('−8 puntos')
  })

  it('are off until the commissioner enables them — in the shop and in auctions', () => {
    const items = [...SURVIVOR_SIDE_GAME_DEFAULTS.tokenShopItems, { id: 'vote_taken', kind: 'vote_taken' as const, enabled: true, cost: 6, amount: 0, powerType: 'extra_vote' as const, samePositionOnly: false }]
    expect(validateSurvivorSideGamePatch(SURVIVOR_SIDE_GAME_DEFAULTS, { tokenShopItems: items })).toMatchObject({ ok: false, code: 'invalid' })
    const ok = validateSurvivorSideGamePatch(SURVIVOR_SIDE_GAME_DEFAULTS, { tokenShopItems: items, disadvantagesEnabled: ['vote_taken', 'opponent_penalty'] })
    expect(ok.ok).toBe(true)
    expect(auctionPrizeDisadvantageError({ kind: 'opponent_penalty', amount: 10, powerType: 'extra_vote', samePositionOnly: false }, [])).toMatch(/turned off/)
    expect(auctionPrizeDisadvantageError({ kind: 'opponent_penalty', amount: 10, powerType: 'extra_vote', samePositionOnly: false }, ['opponent_penalty'])).toBeNull()
    expect(auctionPrizeDisadvantageError({ kind: 'opponent_penalty', amount: 0, powerType: 'extra_vote', samePositionOnly: false }, ['opponent_penalty'])).toMatch(/1 to 500/)
    // Forced bench: the same commissioner opt-in, and a reward-API spec that waits for the choice.
    const bench = { kind: 'forced_bench' as const, amount: 0, powerType: 'extra_vote' as const, samePositionOnly: false }
    expect(auctionPrizeDisadvantageError(bench, ['vote_taken'])).toMatch(/turned off/)
    expect(auctionPrizeDisadvantageError(bench, ['forced_bench'])).toBeNull()
    expect(prizeRewardSpec(bench, 'r1', 8)).toEqual({ type: 'forced_bench', chooserRosterId: 'r1', targetWeek: 8 })
    expect(rewardNeedsChoice({ type: 'forced_bench', chooserRosterId: 'r1' })).toBe(true)
  })

  it('target opponents only (other tribes before the merge); Chimmy aims at the strongest', () => {
    const cast = [
      { rosterId: 'r1', tribeId: 't1', playerState: 'active' }, { rosterId: 'r2', tribeId: 't1', playerState: 'active' },
      { rosterId: 'r3', tribeId: 't2', playerState: 'active' }, { rosterId: 'r4', tribeId: 't2', playerState: 'exile' },
    ]
    expect(disadvantageTargets({ rosterId: 'r1', tribeId: 't1' }, cast, false)).toEqual(['r3'])
    expect(disadvantageTargets({ rosterId: 'r1', tribeId: 't1' }, cast, true)).toEqual(['r2', 'r3'])
    expect(pickChimmyDisadvantageTarget([{ rosterId: 'r2', seasonPoints: 90 }, { rosterId: 'r3', seasonPoints: 120 }], ['r2', 'r3'])).toBe('r3')
  })
})

describe('Free-trade token: the commissioner override never spends it', () => {
  const needed = { ok: true, bypassRequired: true, bypassSource: 'free_trade_token:rb' }
  it('a trade that needed the token spends it', () => {
    expect(survivorBypassSourceToRedeem(needed)).toBe('free_trade_token:rb')
  })
  it('a forced or approved trade does not', () => {
    expect(survivorBypassSourceToRedeem(needed, { commissionerOverride: true })).toBeNull()
    expect(survivorBypassSourceToRedeem(needed, { commissionerApproved: true })).toBeNull()
  })
  it('nor does a trade that did not need it', () => {
    expect(survivorBypassSourceToRedeem({ ok: true, bypassRequired: false, bypassSource: 'free_trade_token:rb' })).toBeNull()
    expect(survivorBypassSourceToRedeem(null)).toBeNull()
  })
})

describe('Exile secrecy and "removed if exposed"', () => {
  const players = [{ playerState: 'exile' }, { playerState: 'active' }, { playerState: 'exile' }]
  it('a viewer who may not know sees no count, no names, and exiles as out', () => {
    expect(visibleExileCount(players, false)).toBeNull()
    expect(visibleExileCount(players, true)).toBe(2)
    expect(exileSafeMembers(players, false).map((p) => p.playerState)).toEqual(['eliminated', 'active', 'eliminated'])
    expect(exilePageVisibility({ membershipHidden: true, viewerIsExile: false, nonPlayingCommissioner: false, players })).toEqual({ showCount: false, count: null, showMembers: false })
    expect(exilePageVisibility({ membershipHidden: true, viewerIsExile: true, nonPlayingCommissioner: false, players })).toEqual({ showCount: true, count: 2, showMembers: true })
    expect(exilePageVisibility({ membershipHidden: true, viewerIsExile: false, nonPlayingCommissioner: true, players })).toMatchObject({ showCount: true, count: 2 })
  })

  it('the exposure penalty needs the rule on, secrecy on, a castaway still in, and a confirm', () => {
    const base = { hidden: true, rule: 'remove' as const, target: { playerState: 'active' }, targetIsActor: false, confirm: false }
    expect(exileExposureCheck(base)).toEqual({ ok: true, penalty: 'remove', confirmed: false })
    expect(exileExposureCheck({ ...base, confirm: true })).toEqual({ ok: true, penalty: 'remove', confirmed: true })
    expect(exileExposureCheck({ ...base, rule: 'off' })).toMatchObject({ ok: false, reason: 'rule_off' })
    expect(exileExposureCheck({ ...base, hidden: false })).toMatchObject({ ok: false, reason: 'not_hidden' })
    expect(exileExposureCheck({ ...base, target: null })).toMatchObject({ ok: false, status: 404 })
    expect(exileExposureCheck({ ...base, target: { playerState: 'eliminated' } })).toMatchObject({ ok: false, reason: 'already_out' })
    expect(exileExposureCheck({ ...base, targetIsActor: true })).toMatchObject({ ok: false, reason: 'self' })
    expect(SURVIVOR_SIDE_GAME_DEFAULTS.exileExposureRule).toBe('off')
  })
})

describe('Legacy Token Pool bridge', () => {
  const games = [{ key: 'BUF@KC', homeKey: 'KC', awayKey: 'BUF' }, { key: 'DAL@PHI', homeKey: 'PHI', awayKey: 'DAL' }]
  it('maps a legacy game id onto the side-game key, never guessing', () => {
    expect(resolveLegacyGameKey('NFL', games, 'BUF@KC', null)).toBe('BUF@KC')
    expect(resolveLegacyGameKey('NFL', games, 'Buffalo Bills@Kansas City Chiefs', null)).toBe('BUF@KC')
    expect(resolveLegacyGameKey('NFL', games, 'legacy-123', 'Philadelphia Eagles')).toBe('DAL@PHI')
    expect(resolveLegacyGameKey('NFL', games, 'legacy-123', 'SEA')).toBeNull()
    expect(legacyWinnerKey('NFL', games[0], 'Kansas City Chiefs')).toBe('KC')
    expect(legacyWinnerKey('NFL', games[0], 'tie')).toBe('tie')
    expect(legacyWinnerKey('NFL', games[0], 'DAL')).toBeNull()
  })

  it('shows side-game picks in the legacy row shape beside the kept history', () => {
    const row = sideGamePickAsLegacyRow('NFL', { pickId: 'tp:u:3:BUF@KC', week: 3, gameKey: 'BUF@KC', teamKey: 'KC', at: '2026-10-01T00:00:00Z', outcome: 'wrong' }, -1)
    expect(row).toMatchObject({ pickType: 'win_pick', isCorrect: false, tokensEarned: 0, tokensLost: 1, source: 'side_game' })
    const legacy = { ...row, id: 'old', submittedAt: '2026-09-01T00:00:00Z', source: 'legacy' as const, week: 1 }
    expect(mergeLegacyTokenPoolRows([row], [legacy]).map((r) => r.id)).toEqual(['tp:u:3:BUF@KC', 'old'])
    expect(mergeLegacyTokenPoolRows([row], [legacy], 1).map((r) => r.id)).toEqual(['old'])
  })
})

describe('Setup screen side games: one shared validator', () => {
  const minimal = {
    tribeCount: 2, tribeFormation: 'random', voteDay: 'Tuesday', voteTime: '20:00', selfVotesAllowed: false, tieRule: 'revote_then_rocks', idolCount: 7,
    hideIdolsFromCommissioner: false, exileEnabled: true, exileReturnTokens: 4, exileBossMode: 'median', exileBossFixedScore: null, exileBossTopN: 3,
    swapEnabled: false, swapWeek: 5, mergeTrigger: 'week', mergeWeek: 7, mergeActivePlayerCount: 8, finalistCount: 3, shareCardsEnabled: true, publicMomentPages: true,
  }
  it('parses the block, refuses a key the screen does not own', () => {
    expect(parseSettingsForm({ ...minimal, sideGames: { survivorPoolNoReuse: true } })?.sideGames).toEqual({ survivorPoolNoReuse: true })
    expect(parseSettingsForm({ ...minimal, sideGames: { tokenShopItems: [] } })).toBeNull()
    expect(parseSettingsForm({ ...minimal, sideGames: 'x' })).toBeNull()
    expect(parseSettingsForm(minimal)?.sideGames).toBeUndefined()
  })

  it('validates with the side games’ own validator and locks', () => {
    expect(validateSideGameScreenValues({ exileTokenFaabRate: 999 })).toEqual(['That value for exileTokenFaabRate is not allowed.'])
    expect(validateSideGameScreenValues({ survivorPoolTieRule: 'loss' })).toEqual([])
    expect(validateSideGameScreenValues({ survivorPoolTieRule: 'loss' }, SURVIVOR_SIDE_GAME_DEFAULTS, ['survivorPoolTieRule'])[0]).toMatch(/locks/)
    expect(changedSideGameScreenKeys({ survivorPoolNoReuse: false, hideExileMembership: false }, { survivorPoolNoReuse: true })).toEqual(['survivorPoolNoReuse'])
  })
})

describe('Rules answers carry the new rules (EN/ES)', () => {
  const s = readSurvivorSideGameSettings({ survivorSideGames: { survivorPoolEnabled: true, survivorPoolTieRule: 'loss', survivorPoolMissedPick: 'revive', survivorPoolNoReuse: true, survivorPoolRule: 'division', survivorPoolDivision: 'AFC North', disadvantagesEnabled: ['vote_taken'], hideExileMembership: true, exileExposureRule: 'remove' } })
  it('pool', () => {
    const en = answerSideGameRules('survivor_pool', s, 'en')
    expect(en).toContain('A tie counts as a loss')
    expect(en).toContain('uses a revive')
    expect(en).toContain('only once all season')
    expect(en).toContain('AFC North division')
    expect(answerSideGameRules('survivor_pool', s, 'es')).toContain('Un empate cuenta como derrota')
  })
  it('auction and exposure', () => {
    expect(answerSideGameRules('auction', s, 'en')).toContain('refunded automatically')
    expect(answerSideGameRules('auction', s, 'en')).toContain('Disadvantages are on offer')
    expect(sideGameExileLines(s, 'NFL', 'en').join(' ')).toContain('remove you from the season')
    expect(sideGameExileLines(s, 'NFL', 'es').join(' ')).toContain('sacarte de la temporada')
  })
})
