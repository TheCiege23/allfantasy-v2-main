// @vitest-environment node
/**
 * The main trades engine honours the trade review chosen at creation, and both trade runtimes read the
 * commissioner's veto threshold — a number of votes by default, or a percent of the teams.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  tradeFindFirst: vi.fn(),
  tradeUpdate: vi.fn(),
  rosterFindFirst: vi.fn(),
  rosterCount: vi.fn(),
  voteCount: vi.fn(),
  coOwner: vi.fn(async () => false),
}))
vi.mock('@/lib/team-coowners/access', () => ({ isAcceptedCoOwnerForRoster: h.coOwner, acceptedCoOwnerRosterId: vi.fn(async () => null) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    afLeagueTrade: { findFirst: h.tradeFindFirst, update: h.tradeUpdate },
    roster: { findFirst: h.rosterFindFirst, findMany: vi.fn(async () => []), count: h.rosterCount },
    afLeagueTradeVote: { upsert: vi.fn(), count: h.voteCount },
  },
}))
vi.mock('@/lib/league-trade-engine/tradeLearningCapture', () => ({
  captureLiveTradeOffer: vi.fn(),
  captureLiveTradeOutcome: vi.fn(),
}))
vi.mock('@/lib/league-trade-engine/tradeAudit', () => ({
  appendAfTradeProcessingEvent: vi.fn(),
  appendAfTradeStatusHistory: vi.fn(),
  logAfTradeAudit: vi.fn(),
}))
vi.mock('@/lib/notification-engine', () => ({ ingest: vi.fn(async () => ({ dispatched: true })), tradeEvent: (o: unknown) => o }))
vi.mock('@/lib/chat-notifications/tradeOfferDm', () => ({ postTradeOfferToDm: vi.fn(), postTradeStatusToDm: vi.fn() }))
vi.mock('@/lib/chat-notifications/tradeOfferSources', () => ({ loadNativeTradeOffer: vi.fn() }))
vi.mock('@/lib/league-events/publisher', () => ({ publishLeagueFanoutEvent: vi.fn() }))

import type { League } from '@prisma/client'
import { readVetoRule, vetoVotesNeeded, storedVetoRule, DEFAULT_VETO_VOTES } from '@/lib/league-trade-engine/vetoRule'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { redraftVetoThreshold, resolveRedraftTradeGovernance } from '@/lib/redraft/tradeGovernance'
import { validateTradeSettings } from '@/lib/commissioner-settings/LeagueRuleValidator'
import { castAfTradeVetoVote } from '@/lib/league-trade-engine/tradeService'

const league = (settings: Record<string, unknown>) => ({ settings, platform: 'allfantasy', bestBallMode: false } as unknown as League)

describe('16 — the trade review chosen at creation runs', () => {
  it('a league created as "League vote" gets a league vote, not the format default', () => {
    // Creation stores the choice as trade_review_mode; commissionerSettings keeps the format's default.
    const s = { trade_review_mode: 'league_vote', commissionerSettings: { tradeReviewMode: 'commissioner' } }
    expect(resolveLeagueTradeSettings(league(s)).tradeReviewMode).toBe('league_vote')
  })
  it('"Instant" (stored as instant or none) skips review', () => {
    expect(resolveLeagueTradeSettings(league({ trade_review_mode: 'instant', commissionerSettings: { tradeReviewMode: 'commissioner' } })).tradeReviewMode).toBe('instant')
    expect(resolveLeagueTradeSettings(league({ trade_review_mode: 'none' })).tradeReviewMode).toBe('instant')
  })
  it('a league with no chosen key still reads its commissioner settings, then commissioner review', () => {
    expect(resolveLeagueTradeSettings(league({ commissionerSettings: { tradeReviewMode: 'league_vote' } })).tradeReviewMode).toBe('league_vote')
    expect(resolveLeagueTradeSettings(league({})).tradeReviewMode).toBe('commissioner')
  })
})

describe('17 — the veto rule', () => {
  it('a number of votes by default: 4 when the league saved none', () => {
    expect(readVetoRule({})).toEqual({ mode: 'count', value: DEFAULT_VETO_VOTES })
    expect(readVetoRule({ vetoThreshold: 5 })).toEqual({ mode: 'count', value: 5 })
    expect(readVetoRule({ vetoThreshold: 0 })).toEqual({ mode: 'count', value: 4 }) // 0 clears it
  })
  it('the commissioner may switch it to a percent of the teams', () => {
    expect(readVetoRule({ vetoThreshold: 60, vetoThresholdMode: 'percent' })).toEqual({ mode: 'percent', value: 60 })
    expect(readVetoRule({ vetoThreshold: 150, vetoThresholdMode: 'percent' })).toEqual({ mode: 'percent', value: 100 })
  })
  it('a percent stored before (concept extensions) still reads when nothing was saved', () => {
    expect(readVetoRule({}, 40)).toEqual({ mode: 'percent', value: 40 })
    expect(readVetoRule({ vetoThreshold: 3 }, 40)).toEqual({ mode: 'count', value: 3 })
  })
  it('votes needed: a count is capped at the teams that can vote; a percent is of every team', () => {
    expect(vetoVotesNeeded({ mode: 'count', value: 4 }, { teamCount: 12, tradingTeams: 2 })).toBe(4)
    expect(vetoVotesNeeded({ mode: 'count', value: 20 }, { teamCount: 12, tradingTeams: 2 })).toBe(10)
    expect(vetoVotesNeeded({ mode: 'percent', value: 50 }, { teamCount: 12, tradingTeams: 2 })).toBe(6)
    expect(vetoVotesNeeded({ mode: 'percent', value: 34 }, { teamCount: 10, tradingTeams: 2 })).toBe(4)
  })
  it('the main engine carries the rule, and the percent column only for a percent', () => {
    const count = resolveLeagueTradeSettings(league({ vetoThreshold: 5 }))
    expect([count.vetoRule, count.vetoThresholdPercent]).toEqual([{ mode: 'count', value: 5 }, null])
    const pct = resolveLeagueTradeSettings(league({ vetoThreshold: 40, vetoThresholdMode: 'percent' }))
    expect([pct.vetoRule, pct.vetoThresholdPercent]).toEqual([{ mode: 'percent', value: 40 }, 40])
  })
  it('the redraft runtime stores the same rule as votes', async () => {
    expect(redraftVetoThreshold({ mode: 'count', value: 5 }, 12)).toBe(5)
    expect(redraftVetoThreshold({ mode: 'count', value: 15 }, 12)).toBe(10)
    expect(redraftVetoThreshold({ mode: 'percent', value: 50 }, 12)).toBe(6)
    const db = {
      redraftLeagueExtendedSettings: { findUnique: vi.fn(async () => ({ commissionerTradeReviewType: 'league_vote' })) },
      league: { findUnique: vi.fn(async () => ({ settings: { vetoThreshold: 3 }, leagueSize: 10 })) },
    }
    expect(await resolveRedraftTradeGovernance(db as never, 'L')).toEqual({ vetoMode: 'league_vote', vetoThreshold: 3 })
    // a caller without the league delegate keeps the old default
    expect((await resolveRedraftTradeGovernance({ redraftLeagueExtendedSettings: db.redraftLeagueExtendedSettings } as never, 'L')).vetoThreshold).toBe(4)
  })
  it('the save validates the number against its mode', () => {
    expect(validateTradeSettings({ vetoThreshold: 5, vetoThresholdMode: 'count' }).valid).toBe(true)
    expect(validateTradeSettings({ vetoThreshold: 31, vetoThresholdMode: 'count' }).valid).toBe(false)
    expect(validateTradeSettings({ vetoThreshold: 80, vetoThresholdMode: 'percent' }).valid).toBe(true)
    expect(validateTradeSettings({ vetoThresholdMode: 'half' as never }).valid).toBe(false)
  })
})

describe('a veto vote counts against the rule stored with the trade', () => {
  const trade = (metadata: Record<string, unknown>, vetoThresholdPercent: number | null = null) => ({
    id: 't1', leagueId: 'L', status: 'awaiting_votes', proposerRosterId: 'p', receiverRosterId: 'r',
    metadata: { participantRosterIds: ['p', 'r'], ...metadata }, vetoThresholdPercent, items: [],
  })
  beforeEach(() => {
    vi.clearAllMocks()
    h.rosterFindFirst.mockResolvedValue({ id: 'v1', platformUserId: 'u' })
    h.rosterCount.mockResolvedValue(12)
  })
  const vote = () => castAfTradeVetoVote({ tradeId: 't1', leagueId: 'L', userId: 'u', voterRosterId: 'v1', vote: 'veto' })

  it('lets an accepted co-owner cast the one vote belonging to their roster', async () => {
    h.rosterFindFirst.mockResolvedValue({ id: 'v1', platformUserId: 'owner' })
    h.coOwner.mockResolvedValueOnce(true)
    h.tradeFindFirst.mockResolvedValue(trade({ vetoRule: { mode: 'count', value: 4 } }))
    h.voteCount.mockResolvedValue(1)
    await vote()
    expect(h.coOwner).toHaveBeenCalledWith('L', 'v1', 'u')
  })

  it('4 votes kill a trade under a 4-vote rule', async () => {
    h.tradeFindFirst.mockResolvedValue(trade({ vetoRule: { mode: 'count', value: 4 } }))
    h.voteCount.mockResolvedValue(3)
    await vote()
    expect(h.tradeUpdate).not.toHaveBeenCalled()
    h.voteCount.mockResolvedValue(4)
    await vote()
    expect(h.tradeUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'vetoed' }) }))
  })
  it('a trade proposed before rules were stored keeps its percent', async () => {
    h.tradeFindFirst.mockResolvedValue(trade({}, 50))
    h.voteCount.mockResolvedValue(5)
    await vote()
    expect(h.tradeUpdate).not.toHaveBeenCalled() // 50% of 12 = 6
    expect(storedVetoRule({})).toBeNull()
  })
})
