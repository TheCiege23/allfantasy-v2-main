// @vitest-environment node
/**
 * Exile Island and the side games as Chimmy and Decision OS see them: the rules answers (EN/ES),
 * Chimmy's grounding (the caller's own balances only), the weekly commissioner report line, Exile
 * secrecy, and the Decision OS signals.
 */
import { describe, expect, it } from 'vitest'
import { answerSurvivorRules, buildSurvivorRulebook, survivorRulesTopic, type SurvivorRulesContext } from '@/lib/survivor/survivorRulesAnswers'
import { readSurvivorSideGameSettings, SURVIVOR_SIDE_GAME_DEFAULTS } from '@/lib/survivor/survivorSideGameSettings'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/normalizeSurvivorSettings'
import { sideGameGroundingLine, sideGameWeeklyReportLine } from '@/lib/survivor/survivorSideGameSummary'
import { canSeeExileMembership, exileSafePlayerState } from '@/lib/survivor/survivorExileSecrecy'
import { chimmyWeeklyReportBody } from '@/lib/survivor/chimmyWeeklyReport'
import { deriveSurvivorSideGameSignals, type SurvivorSideGameSignalInput } from '@/lib/decision-os/survivorSideGameSignals'
import { episodeFactsForPrompt } from '@/lib/survivor/episodeRecap'

const sideGames = readSurvivorSideGameSettings({
  survivorSideGames: {
    exileTokenFaabRate: 50, exileLineupSlots: ['QB', 'RB', 'WR', 'TE', 'FLX'], exileClaimMode: 'faab_bid', hideExileMembership: true,
    tokenPoolMode: 'streak', tokenPoolWrongPick: 'lose_all', tokenShopEnabled: true,
    tokenShopItems: [{ id: 'extra_vote', kind: 'advantage', enabled: true, cost: 4, amount: 0, powerType: 'extra_vote', samePositionOnly: false }],
    survivorPoolEnabled: true, survivorPoolRule: 'conference', survivorPoolConference: 'AFC', survivorPoolPrize: { kind: 'faab', amount: 50 }, survivorPoolRevives: 2,
    auctionCurrency: 'auction_cash', auctionCashPerAuction: 100,
  },
})

function ctx(language: string | null = null): SurvivorRulesContext {
  return {
    sport: 'NFL',
    settings: { ...normalizeSurvivorFoundationSettings({}), exileIslandEnabled: true, eliminationOutcome: 'exile_island' } as SurvivorRulesContext['settings'],
    plan: null,
    sideGames,
    language,
  }
}

describe('rules answers', () => {
  it('routes side-game questions to their own topics before Exile and voting', () => {
    expect(survivorRulesTopic('how does the token pool work on exile?')).toBe('token_pool')
    expect(survivorRulesTopic('how do survivor pool revives work?')).toBe('survivor_pool')
    expect(survivorRulesTopic('when does the auction close?')).toBe('auction')
    expect(survivorRulesTopic('what is in the token shop?')).toBe('token_shop')
  })

  it('answers from the league’s own settings, in English and Spanish', () => {
    const tp = answerSurvivorRules('token_pool', ctx())
    expect(tp).toContain('lose ALL your tokens')
    expect(tp).toContain('Cash the streak out')
    expect(answerSurvivorRules('token_pool', ctx('es'))).toContain('pierdes TODAS tus fichas')
    const pool = answerSurvivorRules('survivor_pool', ctx())
    expect(pool).toContain('from the AFC')
    expect(pool).toContain('$50 FAAB')
    expect(pool).toContain('2 times')
    expect(answerSurvivorRules('auction', ctx())).toContain('$100')
    expect(answerSurvivorRules('token_shop', ctx())).toContain('extra vote: 4 tokens')
  })

  it('the Exile answer carries the FAAB rate, the slots, the bids and the secrecy', () => {
    const exile = answerSurvivorRules('exile', ctx())
    expect(exile).toContain('$50 FAAB')
    expect(exile).toContain('QB RB WR TE W/R/T')
    expect(exile).toContain('sealed bid')
    expect(exile).toContain('secret')
  })

  it('a league with every side game off reads exactly as before', () => {
    const base = { ...ctx(), sideGames: SURVIVOR_SIDE_GAME_DEFAULTS }
    const titles = buildSurvivorRulebook(base).map((s) => s.topic)
    expect(titles).toContain('token_pool') // the Token Pool has always been on for exiles
    expect(titles).not.toContain('survivor_pool')
    expect(titles).not.toContain('token_shop')
    expect(buildSurvivorRulebook({ ...base, sideGames: null }).map((s) => s.topic)).not.toContain('token_pool')
    expect(answerSurvivorRules('survivor_pool', base)).toContain('not running')
  })
})

describe('Chimmy grounding', () => {
  it('states every rule and only the caller’s own balances', () => {
    const line = sideGameGroundingLine({
      settings: sideGames, sport: 'NFL', week: 4,
      me: { state: 'active', tokens: 2, pot: 0, tokenPoolPicksThisWeek: 0, faab: 75, auctionCash: 100, poolAlive: true, poolRevivesLeft: 2, poolBanned: false, poolPickedThisWeek: false, pendingPurchases: 0 },
      openAuctions: [{ label: 'Week 4 Auction', closesAt: 'Fri 9:00 PM ET', currency: 'auction_cash', mode: 'sealed', myBids: 1 }],
      exileBidClosesAt: null,
    })
    expect(line).toContain('$50 FAAB each')
    expect(line).toContain('EXILE IS SECRET')
    expect(line).toContain('no pick yet')
    expect(line).toContain('FAAB $75')
    expect(line).toContain('Week 4 Auction (sealed, auction cash, closes Fri 9:00 PM ET, your bids 1)')
  })
})

describe('weekly commissioner report', () => {
  it('adds Chimmy’s side-game moves per seat and one league line, in Spanish too', () => {
    const line = sideGameWeeklyReportLine({ tokenPoolSettledThisWeek: 3, poolAlive: 5, poolOut: 2, poolBanned: 1, openAuctions: [{ label: 'Wk 6', bids: 4 }], pendingPurchases: 1, enabled: { tokenPool: true, pool: true } }, 'en')
    expect(line).toBe('Side games: 3 Token Pool picks settled; Survivor Pool: 5 alive, 2 out, 1 banned; auction "Wk 6" open with 4 bids; 1 shop purchases waiting on a return.')
    const body = chimmyWeeklyReportBody(6, [{ name: 'Orphan 1', state: 'exile', voted: 0, exileTeam: 'KC', tokenPoolPicks: 1, poolPicked: false, auctionBids: 0 }], 'en', line)
    expect(body).toContain('made 1 Token Pool pick')
    expect(body.split('\n').at(-1)).toBe(line)
    expect(sideGameWeeklyReportLine({ tokenPoolSettledThisWeek: 0, poolAlive: 0, poolOut: 0, poolBanned: 0, openAuctions: [], pendingPurchases: 0, enabled: { tokenPool: true, pool: false } }, 'es')).toBeNull()
    // Without side games the report body is unchanged.
    expect(chimmyWeeklyReportBody(6, [{ name: 'A', state: 'active', voted: 1, exileTeam: null }], 'en')).toBe('Here is what Chimmy did for its team in week 6.\nA: still in the game, voted at Tribal Council.')
  })
})

describe('Exile secrecy', () => {
  it('off by default; on, only exiles and a non-playing commissioner know', () => {
    expect(canSeeExileMembership({ hidden: false, viewerState: 'active', nonPlayingCommissioner: false })).toBe(true)
    expect(canSeeExileMembership({ hidden: true, viewerState: 'active', nonPlayingCommissioner: false })).toBe(false)
    expect(canSeeExileMembership({ hidden: true, viewerState: 'exile', nonPlayingCommissioner: false })).toBe(true)
    expect(canSeeExileMembership({ hidden: true, viewerState: null, nonPlayingCommissioner: true })).toBe(true)
    expect(exileSafePlayerState('exile', false)).toBe('eliminated')
    expect(exileSafePlayerState('exile', true)).toBe('exile')
  })
  it('the public recap says only "voted out" when the destination is hidden', () => {
    const facts = { week: 3, councilNumber: 3, attendingTribe: null, challengeWinner: null, immunity: null, votes: [], idols: [], tiebreak: null, votedOut: 'Sam', remaining: 9 }
    expect(episodeFactsForPrompt({ ...facts, destination: 'out' } as never)).not.toContain('Exile')
    expect(episodeFactsForPrompt({ ...facts, destination: 'exile' } as never)).toContain('Exile Island')
  })
})

describe('Decision OS side-game signals', () => {
  const now = new Date('2026-10-04T08:00:00Z')
  const base: SurvivorSideGameSignalInput = {
    leagueId: 'L1', language: null, role: 'active', week: 5, nextLockAt: '2026-10-04T17:00:00Z',
    tokenPool: { enabled: true, open: true, picksLeft: 1, pot: 0, streak: false },
    pool: { enabled: true, started: true, alive: true, banned: false, picked: false, revivesLeft: 2 },
    auctions: [{ auctionId: 'a1', label: 'Week 5 Auction', closesAt: '2026-10-04T09:30:00Z', takingBids: true, myBids: 0 }],
    shop: { open: true, tokens: 4, cheapest: 3 },
    exileBid: null,
  }
  it('pool pick due tonight, auction closing in 2h, shop open — deterministic ids, own facts only', () => {
    const signals = deriveSurvivorSideGameSignals([base], now)
    expect(signals.map((s) => s.id)).toEqual([
      'survivor_side_game:L1:pool_pick:5',
      'survivor_side_game:L1:auction:a1',
      'survivor_side_game:L1:shop:4',
    ])
    expect(signals[0]).toMatchObject({ type: 'survivor_side_game', severity: 'high', title: 'Survivor Pool pick due tonight', source: 'survivor' })
    expect(signals[1]).toMatchObject({ severity: 'high', title: 'Auction closes in 2h' })
    expect(signals[2].title).toBe('You have 4 tokens: the shop is open')
  })
  it('an exile sees the Token Pool and the Exile claims close; Spanish follows the league', () => {
    const signals = deriveSurvivorSideGameSignals([{ ...base, role: 'exile', language: 'es', auctions: [], shop: null, exileBid: { week: 5, closesAt: '2026-10-04T12:00:00Z', hasBid: false } }], now)
    expect(signals.map((s) => s.id)).toEqual(['survivor_side_game:L1:token_pool:5', 'survivor_side_game:L1:exile_bid:5'])
    expect(signals[1]).toMatchObject({ severity: 'high', title: 'Las pujas por equipos del Exilio cierran en 4 h' })
  })
  it('nothing when nothing is due', () => {
    expect(deriveSurvivorSideGameSignals([{ ...base, nextLockAt: null, pool: { ...base.pool!, picked: true }, auctions: [], shop: { open: true, tokens: 1, cheapest: 3 } }], now)).toEqual([])
  })
})
