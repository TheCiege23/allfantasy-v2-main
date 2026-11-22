/**
 * Counter-offers for an offer waiting on the user (Trade OS, 2026-11-16): the Trade Center's own counter engine,
 * run on the stored offer from the user's side, AF Pro depth, "ask for more" only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/decision-os/trade/evaluateStoredTrade', () => ({ evaluateStoredTrade: vi.fn() }))
vi.mock('@/lib/trade-value-console/runTradeConsoleAnalysis', () => ({ runTradeConsoleAnalysis: vi.fn() }))
vi.mock('@/lib/core-app/corePaywall', () => ({ resolveCoreDepth: vi.fn() }))
vi.mock('@/lib/chimmy-trade/pendingTradeDecisionGrounding', () => ({ listPendingOfferRefs: vi.fn() }))

import { buildPendingCounterOffers, toConsoleInput } from '@/lib/chimmy-trade/pendingCounterOffers'

const unlocked = { unlocked: true, planName: 'AF Pro', label: 'Trade depth' }
const locked = { unlocked: false, planName: 'AF Pro', label: 'Trade depth' }

function evaluated(grade: Record<string, unknown>, source = 'af') {
  return {
    ok: true,
    trade: {
      id: 't',
      origin: { source },
      sideA: { teamId: 'R-them', rosterId: 'R-them', gives: [{ kind: 'player', playerId: '4034', name: 'Their Guy', position: 'WR', idSpace: 'sleeper' }] },
      sideB: {
        teamId: 'R-me',
        rosterId: 'R-me',
        gives: [
          { kind: 'player', playerId: '6794', name: 'My Star', position: 'RB', idSpace: 'sleeper' },
          { kind: 'pick', season: 2027, round: 1, originalTeamId: null, label: '2027 Round 1' },
        ],
      },
    },
    receipt: { grade },
    perspectiveTeamId: 'R-me',
    viewerInTrade: true,
  }
}

const losing = { graded: true, letter: 'D', label: 'Favors them', giveValue: 7000, getValue: 4000, percentDiff: -43, sideAdvantage: 'opponent' }

function counter(name: string, addTo: 'get' | 'give', letter: string, balanced = false) {
  return {
    addTo,
    name,
    position: 'TE',
    asset: { kind: 'player', name },
    rosterPlayerId: name,
    marketValue: 2500,
    assetLeagueValue: 2500,
    grade: { graded: true, letter, label: 'Close', giveValue: 7000, getValue: 6600, percentDiff: -6, sideAdvantage: balanced ? 'even' : 'opponent' },
    remainingGap: 400,
    balanced,
  }
}

let deps: Record<string, ReturnType<typeof vi.fn>>
beforeEach(() => {
  deps = {
    depth: vi.fn().mockResolvedValue(unlocked),
    pendingRefs: vi.fn().mockResolvedValue([{ kind: 'af', tradeId: 'af-1' }, { kind: 'provider', provider: 'sleeper', providerTradeId: 'sl-9' }]),
    evaluate: vi.fn().mockResolvedValue(evaluated(losing)),
    opponentExternalId: vi.fn().mockResolvedValue('ext-them'),
    analyze: vi.fn().mockResolvedValue({ ok: true, counterOffers: [counter('Tight End A', 'get', 'B-'), counter('My Bench Guy', 'give', 'C')] }),
  }
})

const run = (offerId = 'af-1') => buildPendingCounterOffers({ leagueId: 'L', userId: 'me', offerId }, deps as never)

describe('suggest_counter_offer', () => {
  it('runs the Trade Center analysis on the offer, from the user\'s side, with no AI step', async () => {
    const out = await run()
    expect(deps.evaluate).toHaveBeenCalledWith({ leagueId: 'L', ref: { kind: 'af', tradeId: 'af-1' }, userId: 'me', surface: 'chimmy-counter' })
    expect(deps.opponentExternalId).toHaveBeenCalledWith('L', expect.objectContaining({ teamId: 'R-them' }), 'af')
    const input = deps.analyze.mock.calls[0]![0]
    expect(input).toMatchObject({ leagueId: 'L', userId: 'me', skipAi: true, opponentTeamExternalId: 'ext-them', strategy: 'neutral', teamContext: 'my_team' })
    expect(input.sideGive).toEqual([
      { kind: 'player', name: 'My Star', providerIdentity: { provider: 'sleeper', id: '6794', position: 'RB' } },
      { kind: 'pick', year: 2027, round: 1, label: '2027 Round 1' },
    ])
    expect(input.sideGet).toEqual([{ kind: 'player', name: 'Their Guy', providerIdentity: { provider: 'sleeper', id: '4034', position: 'WR' } }])
    expect(out).toContain('- Ask for Tight End A (TE) too: you send [My Star, 2027 Round 1], you receive [Their Guy, Tight End A].')
    expect(out).toContain('you B- — Close; league value you send 7,000, you receive 6,600 (6% apart).')
  })

  it('names only "ask for more" counters — never one where the user adds a player', async () => {
    const out = await run()
    expect(out).not.toContain('My Bench Guy')
  })

  it('is AF Pro depth: a locked user gets the plan name, no counters and no link', async () => {
    deps.depth.mockResolvedValue(locked)
    const out = await run()
    expect(out).toContain('part of AF Pro (Trade depth)')
    expect(out).toMatch(/Do NOT suggest a counter of your own, and do not include a link/)
    expect(out).not.toMatch(/https?:|\//)
    expect(deps.analyze).not.toHaveBeenCalled()
    expect(deps.evaluate).not.toHaveBeenCalled()
  })

  it('fails closed when the plan cannot be read', async () => {
    deps.depth.mockRejectedValue(new Error('down'))
    expect(await run()).toContain('part of AF Pro')
    expect(deps.analyze).not.toHaveBeenCalled()
  })

  it('only accepts an offer actually waiting on this user', async () => {
    const out = await run('someone-elses-trade')
    expect(out).toContain('someone-elses-trade is not an offer waiting on this user')
    expect(deps.evaluate).not.toHaveBeenCalled()
  })

  it('an unreadable inbox is not "no such offer"', async () => {
    deps.pendingRefs.mockRejectedValue(new Error('down'))
    expect(await run()).toContain('the trade inbox could not be read')
  })

  it('needs no counter when the offer already grades even or in the user\'s favour', async () => {
    deps.evaluate.mockResolvedValue(evaluated({ ...losing, letter: 'A', giveValue: 4000, getValue: 5000 }))
    const out = await run()
    expect(out).toContain('none needed — the offer already grades A')
    expect(deps.analyze).not.toHaveBeenCalled()
  })

  it('says so when no counter brings it closer, rather than leaving room to invent one', async () => {
    deps.analyze.mockResolvedValue({ ok: true, counterOffers: [counter('My Bench Guy', 'give', 'C')] })
    const out = await run()
    expect(out).toContain('none found')
    expect(out).toContain('Do not invent a counter.')
  })

  it('a Sleeper offer is countered on Sleeper', async () => {
    deps.evaluate.mockResolvedValue(evaluated(losing, 'provider'))
    const out = await run('sl-9')
    expect(deps.evaluate.mock.calls[0]![0].ref).toEqual({ kind: 'provider', provider: 'sleeper', providerTradeId: 'sl-9' })
    expect(deps.opponentExternalId.mock.calls[0]![2]).toBe('provider')
    expect(out).toContain('The user sends a counter on Sleeper themselves; AllFantasy cannot send it.')
  })

  it('refuses rather than guesses when the other roster cannot be matched or the evaluator refuses', async () => {
    deps.opponentExternalId.mockResolvedValue(null)
    expect(await run()).toContain("the other team's roster could not be matched")
    deps.evaluate.mockResolvedValue({ ok: false, refusal: { code: 'asset_moved', reason: 'Their Guy is no longer on the roster.' } })
    expect(await run()).toContain('not available — Their Guy is no longer on the roster.')
  })

  it('maps a FAAB asset and a non-Sleeper player without inventing a provider id', () => {
    expect(toConsoleInput({ kind: 'faab', amount: 12 })).toEqual({ kind: 'faab', amount: 12 })
    expect(toConsoleInput({ kind: 'player', playerId: 'ri-1', name: 'X', position: 'QB', idSpace: 'rolling_insights' })).toEqual({ kind: 'player', name: 'X' })
  })
})
