/**
 * Legacy-vs-canonical Manager DNA parity/completeness harness (Phase 2C
 * prerequisite, docs/DECISION_OS_MANAGER_DNA_DEDUP_AUDIT.md §7 step 2 / §8).
 *
 * This is NOT a "do these two engines agree" contract test — they can't, by
 * construction: legacy `lib/manager-dna.ts` classifies from raw Sleeper trade
 * history + FAAB spend (a `DNAMetrics` numeric-dial model, 8 "The X"
 * archetypes), while canonical `lib/decision-os/phase6/dna/` classifies from
 * Decision OS behavioral-event patterns + engagement signals (a categorical
 * model, 9 snake_case identities). There is no shared input format to feed
 * both engines identically.
 *
 * What this harness DOES do: for a handful of synthetic scenarios each
 * *thematically* representing a real manager behavior pattern (aggressive
 * trader, waiver-heavy/low-trade, and near-zero activity), it drives BOTH
 * engines — legacy through its real, unmodified public entry point
 * (`computeManagerDNA`, with Prisma + Sleeper API calls mocked so no network/DB
 * access occurs) and canonical through its real `assembleManagerDna` — and
 * records what each produces. This is evidence for the open question in the
 * audit doc (§7 step 2, "Risks to watch"): whether Decision OS's behavioral
 * pipeline has enough depth to plausibly stand in for legacy's direct
 * Sleeper/Prisma computation before any AI consumer migrates. It is NOT proof
 * that the underlying real-world data has equivalent depth for actual
 * leagues — see the findings doc for what remains unanswered.
 *
 * lib/manager-dna.ts is not modified anywhere in this file — every legacy
 * function it exercises is called through its real, existing public API
 * (`computeManagerDNA`), with only its Prisma/Sleeper-client dependencies
 * mocked at the module boundary.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagerDnaInput } from '@/lib/decision-os/phase6/dna/types'

const findManyMock = vi.fn()
const getAllPlayersMock = vi.fn()
const getLeagueTransactionsMock = vi.fn()
const resolveSleeperUserMock = vi.fn()
const getLeagueRostersMock = vi.fn()
const getLeagueUsersMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTradeHistory: { findMany: findManyMock },
    managerDNA: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}))

vi.mock('@/lib/sleeper-client', () => ({
  getAllPlayers: getAllPlayersMock,
  getLeagueTransactions: getLeagueTransactionsMock,
  resolveSleeperUser: resolveSleeperUserMock,
  getLeagueRosters: getLeagueRostersMock,
  getLeagueUsers: getLeagueUsersMock,
}))

type TradeFixture = {
  playersGiven: Array<{ position: string }>
  playersReceived: Array<{ position: string }>
  picksGiven: unknown[]
  picksReceived: unknown[]
  valueGiven: number | null
  valueReceived: number | null
  valueDifferential: number | null
  playerAgeData: Record<string, number> | null
  analysisResult: unknown
  season: number
}

function trade(over: Partial<TradeFixture>): TradeFixture {
  return {
    playersGiven: [],
    playersReceived: [],
    picksGiven: [],
    picksReceived: [],
    valueGiven: null,
    valueReceived: null,
    valueDifferential: null,
    playerAgeData: null,
    analysisResult: null,
    season: 2025,
    ...over,
  }
}

async function runLegacy(trades: TradeFixture[], waiverAmountsWeek1: number[]): Promise<import('@/lib/manager-dna').ManagerDNAProfile> {
  vi.resetModules()
  findManyMock.mockReset()
  getAllPlayersMock.mockReset()
  getLeagueTransactionsMock.mockReset()
  resolveSleeperUserMock.mockReset()

  findManyMock.mockResolvedValue([{ trades }])
  getAllPlayersMock.mockResolvedValue({})
  resolveSleeperUserMock.mockResolvedValue(null) // roster fetch becomes a no-op — rosterPlayerIds is unused by computeMetrics anyway
  getLeagueTransactionsMock.mockImplementation(async (_leagueId: string, week: number) => {
    if (week !== 1) return []
    return waiverAmountsWeek1.map((amount, i) => ({
      type: 'waiver' as const,
      transaction_id: `w-${i}`,
      status: 'complete',
      roster_ids: [1],
      adds: null,
      drops: null,
      draft_picks: [],
      waiver_budget: [{ sender: 1, receiver: 2, amount }],
      leg: 1,
      created: Date.now(),
      creator: 'u1',
      consenter_ids: [],
      status_updated: Date.now(),
    }))
  })

  const { computeManagerDNA } = await import('@/lib/manager-dna')
  return computeManagerDNA('test-manager', ['league-1'])
}

describe('Manager DNA legacy-vs-canonical parity harness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scenario: aggressive risk-taking trader — legacy "The Gambler" vs canonical serial_trader/risk_taking', async () => {
    const trades: TradeFixture[] = Array.from({ length: 10 }, () =>
      trade({
        playersGiven: [{ position: 'RB' }],
        playersReceived: [{ position: 'WR' }],
        valueGiven: 100,
        valueReceived: 140,
        valueDifferential: 40,
      }),
    )
    const legacy = await runLegacy(trades, [10, 10])

    expect(legacy.archetype).toBe('The Gambler')
    expect(legacy.metrics.riskTolerance).toBeGreaterThanOrEqual(0.65)
    expect(legacy.metrics.buyLowTendency).toBeGreaterThanOrEqual(0.5)

    const { assembleManagerDna } = await import('@/lib/decision-os/phase6/dna/dna')
    const canonicalInput: ManagerDnaInput = {
      leagueId: 'league-1',
      managerPatterns: [
        {
          managerId: 'test-manager',
          patterns: [
            {
              patternType: 'trade_proposal_spike',
              confidence: 'high',
              occurrenceCount: 5,
              firstDetectedAt: '2025-09-01T00:00:00.000Z',
              lastDetectedAt: '2025-11-01T00:00:00.000Z',
              evidenceWindows: [],
              derivation: [],
              warnings: [],
            },
          ],
        },
      ],
      managerSignals: [
        {
          managerId: 'test-manager',
          engagementScore: 80,
          engagementTier: 'active',
          activityRates: { lineupEditsPerWeek: 1, waiverClaimsPerWeek: 0.1, tradeProposalsPerWeek: 0.6, loginSessionsPerWeek: 3 },
          completeness: 90,
        },
      ],
    }
    const canonical = assembleManagerDna(canonicalInput).profiles[0]

    expect(canonical.primaryIdentity).toBe('serial_trader')
    expect(canonical.riskTendency).toBe('risk_taking')

    // GAP: legacy's label ("The Gambler") and canonical's label ("serial_trader")
    // are thematically related (both flag a high-risk, trade-heavy manager) but
    // do not share a vocabulary — no automatic mapping exists. See findings doc.
  })

  it('scenario: waiver-heavy, low trade activity — legacy Waiver Hawk vs canonical waiver_hawk', async () => {
    const trades: TradeFixture[] = [
      trade({ valueGiven: 100, valueReceived: 100, valueDifferential: 0 }),
      trade({ valueGiven: 100, valueReceived: 100, valueDifferential: 0 }),
    ]
    const legacy = await runLegacy(trades, [30, 30, 30, 30, 30, 30, 30, 30])

    expect(legacy.archetype).toBe('The Waiver Hawk')
    expect(legacy.metrics.waiverAggressiveness).toBeGreaterThanOrEqual(0.65)
    expect(legacy.metrics.tradeFrequency).toBeLessThanOrEqual(0.5)

    const { assembleManagerDna } = await import('@/lib/decision-os/phase6/dna/dna')
    const canonicalInput: ManagerDnaInput = {
      leagueId: 'league-1',
      managerPatterns: [
        {
          managerId: 'test-manager',
          patterns: [
            {
              patternType: 'waiver_aggression_streak',
              confidence: 'high',
              occurrenceCount: 4,
              firstDetectedAt: '2025-09-01T00:00:00.000Z',
              lastDetectedAt: '2025-11-01T00:00:00.000Z',
              evidenceWindows: [],
              derivation: [],
              warnings: [],
            },
          ],
        },
      ],
      managerSignals: [
        {
          managerId: 'test-manager',
          engagementScore: 65,
          engagementTier: 'moderate',
          activityRates: { lineupEditsPerWeek: 1, waiverClaimsPerWeek: 1.2, tradeProposalsPerWeek: 0.05, loginSessionsPerWeek: 3 },
          completeness: 90,
        },
      ],
    }
    const canonical = assembleManagerDna(canonicalInput).profiles[0]

    expect(canonical.primaryIdentity).toBe('waiver_hawk')

    // ALIGNMENT: this is the one scenario where legacy and canonical use the
    // literal same English words ("Waiver Hawk" / "waiver_hawk") — but that's
    // a coincidence of two independently-designed taxonomies, not a
    // guaranteed or tested mapping for the other 7 legacy / 8 canonical labels.
  })

  it('scenario: near-zero activity — legacy still confidently names an archetype, canonical is explicit about having nothing', async () => {
    const legacy = await runLegacy([], [])

    // GAP (found empirically, not assumed): with zero trade/waiver history,
    // legacy's `patience` and `riskTolerance` defaults (patience defaults to
    // 0.82 when tradeCount===0; riskTolerance defaults to 0 when there are no
    // analyzed trades) happen to satisfy "The Architect"'s check
    // (patience >= 0.65 && riskTolerance <= 0.45 && pickHoarding >= 0.5) —
    // NOT the "nothing matched" fallback ("The Balanced GM", only used when
    // zero archetype checks pass). A manager with literally no data is
    // labeled a specific, confident-sounding archetype rather than something
    // that reads as "we don't know yet."
    expect(legacy.archetype).toBe('The Architect')
    // The one honest signal legacy does surface for this case is a low
    // `confidence` score — but that's opt-in: a caller has to know to check
    // it separately from the archetype label, which formatDNAForPrompt() does
    // (it goes silent below 0.15) but nothing else is required to.
    expect(legacy.confidence).toBeLessThan(0.15)

    const { assembleManagerDna } = await import('@/lib/decision-os/phase6/dna/dna')
    const canonicalInput: ManagerDnaInput = {
      leagueId: 'league-1',
      managerPatterns: [],
      managerSignals: [],
    }
    const canonical = assembleManagerDna(canonicalInput).profiles

    // ALIGNMENT: canonical has no comparable failure mode. With no manager
    // patterns or signals supplied at all, there is no per-manager entry to
    // mislabel in the first place — the result set is simply empty. If a
    // manager entry IS present with near-zero signal (completeness below the
    // MIN_COMPLETENESS=20 threshold), Phase 6 emits the literal string
    // 'unknown' rather than a specific archetype name, materially more
    // honest than legacy's default-to-a-real-label behavior.
    expect(canonical).toEqual([])
  })
})
