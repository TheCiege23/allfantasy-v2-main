/**
 * ONE completed Sleeper trade, replayed through every surface that grades it — the promotion gate's
 * "same trade, same grade, same values, same direction" requirement, asserted on the REAL input
 * builders rather than on each surface in isolation.
 *
 *   A  grade email · Trade Center timeline · dashboard band (ledger) · Chimmy · commissioner review
 *        → `completedTradeInputs(GradedTrade)`
 *   B  /core Trades history · player card        → `gradeArchivedTradeRows` (archived `LeagueTrade`)
 *   C  pending inbox · /core inbox · Trade Center panel → `gradeInputsFromPending(buildTradeAssetsForRoster)`
 *   D  League Buzz activity feed                 → `gradeSleeperActivityTrade`
 *   E  dashboard band, trade not yet in ledger   → `liveCompletedTrade` + `gradeProviderRecentTrade`
 *
 * 🛑 WHY THIS EXISTS (2026-09-28). A, B, D and E sent players to the grader by NAME; C sent the Sleeper
 * id and position. A name is priced through `findPlayerByName` and a lower-cased name map, an id
 * exactly — and this repo carries 178 NFL duplicate-name groups. One deal could be priced as two
 * different people depending on which screen read it, with nothing anywhere going red.
 *
 * The grader is a recorder that prices by IDENTITY (the Sleeper id, never the name), so a surface that
 * drops the id prices nothing and fails loudly here instead of silently in production.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

type Asset = { kind: string; name?: string; providerIdentity?: { id: string }; year?: number; round?: number }
type Call = { give: Asset[]; get: Asset[]; viewerSide: boolean }
const calls = new Map<string, Call[]>()

/** Sleeper id → league value. A name alone is worth nothing to this grader, on purpose. */
const VALUES: Record<string, number> = {
  'sleeper:11583': 3100, // Tyrone Tracy Jr. — RB
  'sleeper:7072': 1250, //  Quincy Williams — LB (IDP)
  'sleeper:12507': 2400, // the rookie drafted with a used 2026 1st
  'pick:2027:1': 4200,
  'pick:2027:2': 900,
}
const keyOf = (a: Asset) =>
  a.kind === 'pick' ? `pick:${a.year}:${a.round}` : a.providerIdentity ? `sleeper:${a.providerIdentity.id}` : `name:${a.name}`

vi.mock('@/lib/decision-os/trade/leagueTradeGrader', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/decision-os/trade/leagueTradeGrader')>()
  const { gradeTrade } = await import('@/lib/decision-os/trade/tradeGrade')
  return {
    ...orig,
    createLeagueTradeGrader: vi.fn(async ({ leagueId }: { leagueId: string }) => ({
      leagueId,
      chart: {},
      leagueType: null,
      async grade(deal: Call) {
        calls.set(leagueId, [...(calls.get(leagueId) ?? []), deal])
        const missing = [...deal.give, ...deal.get].filter((a) => VALUES[keyOf(a)] == null)
        if (missing.length > 0) return { graded: false, reason: `${missing.map(keyOf).join(', ')} has no value on this league’s chart`, basis: null }
        const total = (xs: Asset[]) => xs.reduce((s, a) => s + VALUES[keyOf(a)]!, 0)
        return gradeTrade({
          giveValue: total(deal.give), getValue: total(deal.get), giveMarket: total(deal.give), getMarket: total(deal.get),
          unpriced: 0, giveCount: deal.give.length, getCount: deal.get.length,
          basis: 'Dynasty · 1QB · 32 teams · PPR · IDP', scoringApplied: true, needApplied: false, needGap: null, lines: [], moves: [],
        })
      },
    })),
  }
})

// The ledger sides the archived path pairs picks against — set per test.
let ledgerSides: unknown[] | undefined
vi.mock('@/lib/core-app/archivedPickOutcomes', () => ({
  ledgerKey: (league: string, tx: string) => `${league}:${tx}`,
  loadLedgerSidesForTrades: vi.fn(async (keys: Array<{ sleeperLeagueId: string; transactionId: string }>) =>
    new Map(keys.map((k) => [`${k.sleeperLeagueId}:${k.transactionId}`, ledgerSides]))),
}))

import { completedTradeInputs, oneGradeForCompletedTrade } from '@/lib/decision-os/trade/completedTradeGrade'
import { mirrorLetter } from '@/lib/decision-os/trade/tradeGrade'
import { gradeInputsFromPending } from '@/lib/decision-os/trade/tradeGradeInputs'
import { buildTradeAssetsForRoster } from '@/lib/provider-trades/scanPendingSleeperTrades'
import { gradeArchivedTradeRows } from '@/lib/core-app/archivedTradeGrade'
import { clearActivityTradeGradeMemo, gradeSleeperActivityTrade } from '@/lib/activity/tradeGrades'
import { gradeProviderRecentTrade, liveCompletedTrade } from '@/lib/core-app/recentTrades'
import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'

const SEASON = 2026
const PLAYERS = {
  '11583': { full_name: 'Tyrone Tracy Jr.', position: 'RB', team: 'NYG' },
  '7072': { full_name: 'Quincy Williams', position: 'LB', team: 'NYJ' },
  '12507': { full_name: 'Rookie Receiver', position: 'WR', team: 'LAR' },
}

/**
 * Roster 1 sends Tracy and its own 2027 2nd; roster 2 sends Quincy Williams and its 2027 1st.
 * On a Sleeper pick `roster_id` is the ORIGINAL owner and `owner_id` the receiver.
 */
function sleeperTx(extraPicks: Array<Record<string, unknown>> = []) {
  return {
    type: 'trade', transaction_id: 'tx-kbfl', status: 'complete', roster_ids: [1, 2],
    adds: { '11583': 2, '7072': 1 }, drops: { '11583': 1, '7072': 2 },
    draft_picks: [
      { season: '2027', round: 2, roster_id: 1, previous_owner_id: 1, owner_id: 2 },
      { season: '2027', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 },
      ...extraPicks,
    ],
    waiver_budget: [], leg: 3, created: 0, creator: 'x', consenter_ids: [1, 2], status_updated: 0,
  }
}

const player = (id: keyof typeof PLAYERS) => ({ playerId: id, name: PLAYERS[id].full_name, position: PLAYERS[id].position })
const ledgerPick = (season: string, round: number, originalRosterId: number, drafted: keyof typeof PLAYERS | null = null) => ({
  season, round, originalRosterId, label: `${season} round ${round}`, pending: !drafted, rerouted: false,
  resolved: drafted ? { ...player(drafted), creditedBySeason: {}, departed: null } : null,
})

/** The same trade as the graded ledger holds it — side one is roster 1. */
function gradedTrade(usedPick = false): GradedTrade {
  const used = usedPick ? [ledgerPick('2026', 1, 2, '12507')] : []
  return {
    id: 'tx-kbfl', season: '2026', week: 3, createdIso: '', multiTeam: false, tie: false, hasPendingPicks: false,
    sides: [
      { rosterId: 1, playersIn: [player('7072')], playersOut: [player('11583')], picksIn: [ledgerPick('2027', 1, 2), ...used], picksOut: [ledgerPick('2027', 2, 1)] },
      { rosterId: 2, playersIn: [player('11583')], playersOut: [player('7072')], picksIn: [ledgerPick('2027', 2, 1)], picksOut: [ledgerPick('2027', 1, 2), ...used] },
    ],
  } as unknown as GradedTrade
}

/** One manager's archived copy — `LeagueTrade` keys players by Sleeper id. */
function archivedRow(roster: 1 | 2, usedPick = false) {
  const used = usedPick ? [{ season: '2026', round: 1 }] : []
  const oneGets = { players: ['7072'], picks: [{ season: '2027', round: 1 }, ...used] }
  const twoGets = { players: ['11583'], picks: [{ season: '2027', round: 2 }] }
  const [mine, theirs] = roster === 1 ? [oneGets, twoGets] : [twoGets, oneGets]
  return {
    transactionId: 'tx-kbfl',
    playersReceived: mine.players, playersGiven: theirs.players,
    picksReceived: mine.picks, picksGiven: theirs.picks,
    partnerRosterId: roster === 1 ? 2 : 1,
  }
}

const canon = (xs: Asset[]) => xs.map(keyOf).sort()
const lastCall = (leagueId: string) => calls.get(leagueId)!.at(-1)!
let n = 0
const league = () => `af-parity-${++n}` // the grader is memoised per league id; a fresh id per read

beforeEach(() => {
  calls.clear()
  clearActivityTradeGradeMemo()
  ledgerSides = undefined
})

describe('one completed trade, every surface: same assets, same identities, same direction', () => {
  it('each surface sends the grader the SAME assets, by Sleeper id — roster 1’s side', async () => {
    const expected = { give: ['pick:2027:2', 'sleeper:11583'], get: ['pick:2027:1', 'sleeper:7072'] }

    // A — the ledger path (email, timeline, band, Chimmy, review)
    const a = completedTradeInputs(gradedTrade(), SEASON)!
    expect({ give: canon(a.give.assets), get: canon(a.get.assets) }).toEqual(expected)

    // B — /core Trades history + player card
    const lb = league()
    await gradeArchivedTradeRows({
      afLeagueId: lb, platformLeagueId: 'sl-kbfl', rows: [archivedRow(1)], currentSeason: SEASON,
      nameOf: (id) => PLAYERS[id as keyof typeof PLAYERS]?.full_name ?? null,
    })
    expect({ give: canon(lastCall(lb).give), get: canon(lastCall(lb).get) }).toEqual(expected)

    // C — the live Sleeper paths (pending inbox, /core inbox, Trade Center panel)
    const c = buildTradeAssetsForRoster({ tx: sleeperTx() as never, userRosterId: 1, players: PLAYERS as never })
    expect({
      give: canon(gradeInputsFromPending(c.assetsGiven, 'sleeper').assets),
      get: canon(gradeInputsFromPending(c.assetsReceived, 'sleeper').assets),
    }).toEqual(expected)

    // D — League Buzz
    const ld = league()
    await gradeSleeperActivityTrade({ afLeagueId: ld, tx: sleeperTx() as never, rosterNames: new Map(), players: PLAYERS, now: Date.UTC(SEASON, 9, 1) })
    expect({ give: canon(lastCall(ld).give), get: canon(lastCall(ld).get) }).toEqual(expected)

    // E — the dashboard band before the ledger has the trade
    const le = league()
    const live = liveCompletedTrade(
      { id: le, name: 'KBFL', platformLeagueId: 'sl-kbfl' },
      { transactionId: 'tx-kbfl', proposedAt: '2026-09-20T00:00:00Z', proposedBy: 'Them', viewerRosterExternalId: '1', counterpartyRosterExternalId: '2', ...c } as never,
    )!
    await gradeProviderRecentTrade(live, new Date(Date.UTC(SEASON, 9, 1)))
    expect({ give: canon(lastCall(le).give), get: canon(lastCall(le).get) }).toEqual(expected)
  })

  it('every surface reads the SAME letters, and the other side is the exact mirror', async () => {
    const la = league()
    const a = await oneGradeForCompletedTrade(la, gradedTrade(), SEASON)
    if (!a.graded) throw new Error(`expected a grade, got: ${a.reason}`)
    // Roster 1 gives 3,100 + 900 and gets 1,250 + 4,200: a real edge, so a swapped side would show.
    expect([a.giveValue, a.getValue]).toEqual([4000, 5450])
    expect(a.letter).not.toBe(a.partnerLetter)

    // B from each manager's own copy of the trade: roster 2's copy is the mirror, not a second opinion.
    const nameOf = (id: string) => PLAYERS[id as keyof typeof PLAYERS]?.full_name ?? null
    const lb = league()
    const rows = await gradeArchivedTradeRows({ afLeagueId: lb, platformLeagueId: 'sl-kbfl', rows: [archivedRow(1)], currentSeason: SEASON, nameOf })
    const rows2 = await gradeArchivedTradeRows({ afLeagueId: league(), platformLeagueId: 'sl-kbfl', rows: [archivedRow(2)], currentSeason: SEASON, nameOf })
    const b1 = rows.get('tx-kbfl')!.grade
    const b2 = rows2.get('tx-kbfl')!.grade
    if (!b1.graded || !b2.graded) throw new Error('expected both archived copies to grade')
    expect([b1.letter, b1.partnerLetter]).toEqual([a.letter, a.partnerLetter])
    expect([b2.letter, b2.partnerLetter]).toEqual([a.partnerLetter, a.letter])
    expect(a.partnerLetter).toBe(mirrorLetter(a.letter))

    // D — League Buzz names both sides with the same two letters.
    const d = await gradeSleeperActivityTrade({
      afLeagueId: league(), tx: sleeperTx() as never, rosterNames: new Map([[1, 'You'], [2, 'Them']]), players: PLAYERS, now: Date.UTC(SEASON, 9, 1),
    })
    expect(d).toEqual({ graded: true, basis: 'today', sides: [{ name: 'You', letter: a.letter }, { name: 'Them', letter: a.partnerLetter }] })

    // E — the band's two sides.
    const c = buildTradeAssetsForRoster({ tx: sleeperTx() as never, userRosterId: 1, players: PLAYERS as never })
    const live = liveCompletedTrade(
      { id: league(), name: 'KBFL', platformLeagueId: 'sl-kbfl' },
      { transactionId: 'tx-kbfl', proposedAt: '2026-09-20T00:00:00Z', proposedBy: 'Them', viewerRosterExternalId: '1', counterpartyRosterExternalId: '2', ...c } as never,
    )!
    await gradeProviderRecentTrade(live, new Date(Date.UTC(SEASON, 9, 1)))
    expect(live.sides.map((s) => s.grade)).toEqual([a.letter, a.partnerLetter])
  })

  it('a used pick is the player drafted with it on BOTH ledger-backed paths, by his id', async () => {
    ledgerSides = gradedTrade(true).sides
    const a = completedTradeInputs(gradedTrade(true), SEASON)!
    const lb = league()
    await gradeArchivedTradeRows({
      afLeagueId: lb, platformLeagueId: 'sl-kbfl', rows: [archivedRow(1, true)], currentSeason: SEASON,
      nameOf: (id) => PLAYERS[id as keyof typeof PLAYERS]?.full_name ?? null,
    })
    expect(canon(a.get.assets)).toContain('sleeper:12507')
    expect(canon(lastCall(lb).get)).toEqual(canon(a.get.assets))
  })

  /*
   * ⚠ KNOWN GAP, PINNED SO THAT FIXING IT IS DELIBERATE. The live paths (C, D, E) read Sleeper's raw
   * transaction, which names a pick by season and round and never says who was drafted with it; only
   * the ledger resolves that. So for a trade younger than the ledger's cache, a used 2026 1st is
   * priced as a pick there and as the drafted rookie on A and B. In the Trade Center timeline the
   * ledger copy wins as soon as it exists (`mergeImportedTradeTimelineRows`). `it.fails`: when a live
   * path learns draft results this turns red, and the marker comes off.
   */
  it.fails('KNOWN GAP: a live path cannot name the player drafted with a used pick', () => {
    const c = buildTradeAssetsForRoster({
      tx: sleeperTx([{ season: '2026', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 }]) as never,
      userRosterId: 1, players: PLAYERS as never,
    })
    const a = completedTradeInputs(gradedTrade(true), SEASON)!
    expect(canon(gradeInputsFromPending(c.assetsReceived, 'sleeper').assets)).toEqual(canon(a.get.assets))
  })

  it('an asset the chart cannot price withholds the letter on every surface — never a partial letter', async () => {
    const missing = { ...PLAYERS, '9999': { full_name: 'Unpriced Linebacker', position: 'LB', team: 'FA' } }
    const tx = { ...sleeperTx(), adds: { ...sleeperTx().adds, '9999': 1 }, drops: { ...sleeperTx().drops, '9999': 2 } }
    const trade = gradedTrade()
    ;(trade.sides[0]!.playersIn as unknown[]).push({ playerId: '9999', name: 'Unpriced Linebacker', position: 'LB' })

    expect((await oneGradeForCompletedTrade(league(), trade, SEASON)).graded).toBe(false)
    const d = await gradeSleeperActivityTrade({ afLeagueId: league(), tx: tx as never, rosterNames: new Map(), players: missing, now: Date.UTC(SEASON, 9, 1) })
    expect(d?.graded).toBe(false)
    const c = buildTradeAssetsForRoster({ tx: tx as never, userRosterId: 1, players: missing as never })
    const live = liveCompletedTrade(
      { id: league(), name: 'KBFL', platformLeagueId: 'sl-kbfl' },
      { transactionId: 'tx-kbfl', proposedAt: '2026-09-20T00:00:00Z', proposedBy: 'Them', viewerRosterExternalId: '1', counterpartyRosterExternalId: '2', ...c } as never,
    )!
    await gradeProviderRecentTrade(live, new Date(Date.UTC(SEASON, 9, 1)))
    expect(live.sides.map((s) => s.grade)).toEqual([null, null])
  })

  it('an archived player with no name on file still withholds, even though his id now rides along', async () => {
    const lb = league()
    const rows = await gradeArchivedTradeRows({
      afLeagueId: lb, platformLeagueId: 'sl-kbfl', rows: [archivedRow(1)], currentSeason: SEASON,
      nameOf: (id) => (id === '7072' ? null : PLAYERS[id as keyof typeof PLAYERS]?.full_name ?? null),
    })
    expect(rows.get('tx-kbfl')!.grade).toMatchObject({ graded: false, reason: expect.stringMatching(/a player with no name on file/) })
    expect(calls.get(lb)).toBeUndefined() // withheld before the grader is asked
  })
})
