/**
 * "Trade for this pick" (owner's rule, 2026-11-26): visibility, and the suggestions it asks for.
 *
 * 1. The rule (`lib/draft-room/tradeForPick.ts`): a pick clock under 5 minutes hides it, 5 minutes or more
 *    shows it; an auction, a draft that is not live and a league with pick trades off hide it; on the board,
 *    a made pick, the viewer's own pick, a keeper slot and a pick held by trade hide it.
 * 2. The suggestions route, `for_their_pick`: the target is the partner's ONE pick, the candidates are the
 *    viewer's own picks for it, ranked by how close to even THE league grade is, at most three; a fast
 *    draft gets none. The grader is the only double (the `draft-pick-trade-surfaces-canonical` harness).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TRADE_FOR_PICK_MIN_TIMER_SECONDS,
  tradeForPickDraftEligible,
  tradeForPickTileEligible,
} from '@/lib/draft-room/tradeForPick'

const h = vi.hoisted(() => ({
  grade: vi.fn(),
  createGrader: vi.fn(),
  session: null as any,
  ui: { pickTradeEnabled: true } as { pickTradeEnabled: boolean },
  prisma: { draftSession: { findFirst: vi.fn() } },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'user-a' } })) }))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({
  createLeagueTradeGrader: (...a: unknown[]) => h.createGrader(...a),
  gradeDeal: async (grader: any, args: any) =>
    grader ? grader.grade({ give: args.give.assets, get: args.get.assets, viewerSide: args.viewerSide }) : { graded: false, reason: 'no league', basis: null },
}))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({ getWarmDraftPoolSnapshotFast: vi.fn(async () => ({ warm: false })) }))
vi.mock('@/lib/live-draft-engine/auth', () => ({
  canAccessLeagueDraft: vi.fn(async () => true),
  getCurrentUserRosterIdForLeague: vi.fn(async () => 'ra'),
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({
  getDraftSessionByLeague: vi.fn(async () => h.session),
  buildSessionSnapshot: vi.fn(async () => null),
}))
vi.mock('@/lib/draft-defaults/DraftUISettingsResolver', () => ({ getDraftUISettingsForLeague: vi.fn(async () => h.ui) }))
vi.mock('@/lib/openai-client', () => ({ openaiChatJson: vi.fn(), parseJsonContentFromChatCompletion: vi.fn() }))
vi.mock('@/lib/provider-config', () => ({ getProviderStatus: () => ({ anyAi: false }) }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    async resolveForUser() {
      return { hasAccess: false }
    }
  },
}))
vi.mock('@/lib/draft/getCanonicalDraftState', () => ({ getCanonicalDraftState: vi.fn(async () => null) }))

const SLOTS = [
  { slot: 1, rosterId: 'ra', displayName: 'Alpha' },
  { slot: 2, rosterId: 'rb', displayName: 'Beta' },
  { slot: 3, rosterId: 'rc', displayName: 'Gamma' },
  { slot: 4, rosterId: 'rd', displayName: 'Delta' },
]
const session = (extra: Record<string, unknown> = {}) => ({
  id: 's1',
  leagueId: 'L',
  status: 'in_progress',
  draftType: 'snake',
  thirdRoundReversal: false,
  teamCount: 4,
  rounds: 4,
  slotOrder: SLOTS,
  tradedPicks: [],
  picks: [],
  draftModeLabel: 'rookie',
  playerPool: 'rookies_only',
  timerSeconds: 8 * 3600,
  startedAt: new Date('2026-05-01T00:00:00Z'),
  createdAt: new Date('2026-04-01T00:00:00Z'),
  ...extra,
})
const view = (letter: string, partnerLetter: string, giveValue: number, getValue: number) => ({
  graded: true, letter, partnerLetter, label: 'label', action: 'review', giveValue, getValue, recommendation: `rec ${letter}`,
})
const json = (body: unknown) => ({ json: async () => body }) as any
const ctx = { params: Promise.resolve({ leagueId: 'L' }) } as any

let suggestions: typeof import('@/app/api/leagues/[leagueId]/draft/trade-builder/suggestions/route').POST
beforeAll(async () => {
  suggestions = (await import('@/app/api/leagues/[leagueId]/draft/trade-builder/suggestions/route')).POST
}, 300_000)

beforeEach(() => {
  vi.clearAllMocks()
  h.grade.mockReset()
  h.session = session()
  h.ui = { pickTradeEnabled: true }
  h.createGrader.mockResolvedValue({ grade: h.grade })
})

describe('1. who sees "Trade for this pick"', () => {
  const draft = (extra: Partial<Parameters<typeof tradeForPickDraftEligible>[0]> = {}) => ({
    timerSeconds: 3600,
    draftType: 'snake',
    status: 'in_progress',
    pickTradeEnabled: true,
    ...extra,
  })

  it('a pick clock under 5 minutes hides it; 5 minutes or more shows it', () => {
    expect(TRADE_FOR_PICK_MIN_TIMER_SECONDS).toBe(300)
    expect(tradeForPickDraftEligible(draft({ timerSeconds: 90 }))).toBe(false)
    expect(tradeForPickDraftEligible(draft({ timerSeconds: 299 }))).toBe(false)
    expect(tradeForPickDraftEligible(draft({ timerSeconds: 300 }))).toBe(true)
    expect(tradeForPickDraftEligible(draft({ timerSeconds: 8 * 3600 }))).toBe(true)
    // No clock at all is not a slow draft.
    expect(tradeForPickDraftEligible(draft({ timerSeconds: null }))).toBe(false)
  })

  it('never in an auction, never with pick trades off, never outside a live draft', () => {
    expect(tradeForPickDraftEligible(draft({ draftType: 'auction' }))).toBe(false)
    expect(tradeForPickDraftEligible(draft({ pickTradeEnabled: false }))).toBe(false)
    expect(tradeForPickDraftEligible(draft({ status: 'paused' }))).toBe(false)
    expect(tradeForPickDraftEligible(draft({ status: 'completed' }))).toBe(false)
  })

  it('only another team’s upcoming pick in their own slot: not made, not mine, not a keeper slot, not held by trade', () => {
    const tile = (extra: Partial<Parameters<typeof tradeForPickTileEligible>[0]> = {}) => ({
      viewerRosterId: 'ra', ownerRosterId: 'rb', slotRosterId: 'rb', made: false, ...extra,
    })
    expect(tradeForPickTileEligible(tile())).toBe(true)
    expect(tradeForPickTileEligible(tile({ made: true }))).toBe(false)
    expect(tradeForPickTileEligible(tile({ ownerRosterId: 'ra', slotRosterId: 'ra' }))).toBe(false)
    expect(tradeForPickTileEligible(tile({ keeperLocked: true }))).toBe(false)
    expect(tradeForPickTileEligible(tile({ slotRosterId: 'rc' }))).toBe(false)
    expect(tradeForPickTileEligible(tile({ viewerRosterId: null }))).toBe(false)
  })
})

describe('2. suggestions for their pick', () => {
  const ask = (extra: Record<string, unknown> = {}) =>
    suggestions(json({ partnerRosterId: 'rb', suggestionKind: 'for_their_pick', anchorReceiveRound: 1, anchorReceiveSlot: 2, ...extra }), ctx)

  it('offers the viewer’s own picks for the target, closest to even on THE league grade first, at most three', async () => {
    // Alpha owns #1 (1.01), #8 (2.01), #9 (3.01), #16 (4.01) in a 4-team snake; the target is Beta's 1.02 (#2).
    h.grade.mockImplementation(async ({ give, get }: any) => {
      expect(get[0]).toMatchObject({ round: 1, roundPick: 2 }) // every candidate asks for the target
      const r = give[0].round
      // Overall distance would rank 1.01 first; the grade says 3.01 is the most even.
      if (r === 1) return view('F', 'A', 6000, 3000)
      if (r === 2) return view('D', 'B', 4200, 3000)
      if (r === 3) return view('C', 'C', 3050, 3000)
      return view('A', 'F', 1000, 3000)
    })
    const body = await (await ask()).json()
    expect(body.ok).toBe(true)
    expect(body.rankingBasis).toBe('league_value')
    expect(body.suggestions).toHaveLength(3)
    expect(body.suggestions.map((s: any) => s.giveRound)).toEqual([3, 2, 1])
    for (const s of body.suggestions) {
      expect(s).toMatchObject({ suggestionKind: 'for_their_pick', giveSlot: 1, receiveRound: 1, receiveSlot: 2 })
      expect(s.tradeGrade).toMatchObject({ graded: true })
    }
    expect(body.suggestions[0].rationale).toMatch(/league grade you C · them C/)
  })

  it('a fast draft (pick clock under 5 minutes), an auction, or trades off get no suggestions and never grade', async () => {
    h.session = session({ timerSeconds: 90 })
    expect((await (await ask()).json()).suggestions).toEqual([])
    h.session = session({ draftType: 'auction' })
    expect((await (await ask()).json()).suggestions).toEqual([])
    h.session = session()
    h.ui = { pickTradeEnabled: false }
    expect((await (await ask()).json()).suggestions).toEqual([])
    expect(h.grade).not.toHaveBeenCalled()
  })

  it('a target that is no longer theirs (made, or not their pick) says so', async () => {
    h.session = session({ picks: [{ overall: 2, playerName: 'Gone', position: 'WR' }] })
    const made = await (await ask()).json()
    expect(made.suggestions).toEqual([])
    expect(made.emptyReason).toMatch(/no longer theirs/)
    const notTheirs = await (await ask({ anchorReceiveSlot: 3 })).json()
    expect(notTheirs.suggestions).toEqual([])
  })
})
