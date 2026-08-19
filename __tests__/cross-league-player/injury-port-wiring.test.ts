/**
 * Slice 18 — injury read port wired into the cross-league portfolio.
 *
 * WHY: prod measurement (scripts/audit-player-injury-status.cjs, 2026-08-10)
 * showed `SportsPlayerRecord.injuryStatus` is ~92% ROSTER designation
 * (INACT 7,159 / ACT 2,305 / Active 200 / NA 65) with exactly ONE 'Out' in the
 * entire NFL, while Rolling Insights reported 311 live injuries. Urgency
 * (playerUrgency.ts) escalates on the portfolio's injury.status, so the
 * Sunday-panic detection had almost nothing to fire on.
 *
 * These tests pin the contract of the fix:
 *   1. An RI injury row WINS over the player-record token.
 *   2. Roster tokens (INACT/ACT/Active/NA) NEVER produce an injury severity —
 *      including the old availability-category coercion of 'NA' → 'out'.
 *   3. A stale RI row is carried but FLAGGED, never rendered plainly.
 *   4. A null RI designation surfaces as 'unknown' — "no designation stated"
 *      is NOT "healthy".
 *   5. ambiguous[] from the port is reported on the result, not swallowed.
 *   6. Genuine player-record injury tokens still work as fallback.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  rosterFindMany,
  leagueTeamFindMany,
  userProfileFindUnique,
  fantasyProjectionFindMany,
  resolvePlayersMock,
  resolveInjuryContextMock,
  resolveScheduleContextMock,
  assembleUserOsRecommendationsMock,
  resolveInjuryFactsMock,
} = vi.hoisted(() => ({
  rosterFindMany: vi.fn(),
  leagueTeamFindMany: vi.fn(),
  userProfileFindUnique: vi.fn(),
  fantasyProjectionFindMany: vi.fn(),
  resolvePlayersMock: vi.fn(),
  resolveInjuryContextMock: vi.fn(),
  resolveScheduleContextMock: vi.fn(),
  assembleUserOsRecommendationsMock: vi.fn(),
  resolveInjuryFactsMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roster: { findMany: rosterFindMany },
    leagueTeam: { findMany: leagueTeamFindMany },
    userProfile: { findUnique: userProfileFindUnique },
    fantasyProjection: { findMany: fantasyProjectionFindMany },
  },
}))
vi.mock('@/lib/shared-services/player-identity', () => ({ resolvePlayers: resolvePlayersMock }))
vi.mock('@/lib/decision-os/world/injuryEnrichedWorld', () => ({ resolveInjuryContext: resolveInjuryContextMock }))
vi.mock('@/lib/decision-os/world/scheduleBye', () => ({ resolveScheduleContext: resolveScheduleContextMock }))
vi.mock('@/lib/shared-services/league-hub/userOsRecommendations', () => ({ assembleUserOsRecommendations: assembleUserOsRecommendationsMock }))
vi.mock('@/lib/injuries/injuryReadPort', () => ({ resolveInjuryFacts: resolveInjuryFactsMock }))

import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { baseRoster, resolutionFor } from './fixtures'

const NOW = new Date('2026-08-10T12:00:00Z')

/** Build an InjuryResolution the way the real port shapes it — keyed by normalized name. */
function riResolution(
  facts: Array<{ name: string; status: string | null; stale?: boolean; fetchedAt?: Date }>,
  opts: { ambiguous?: string[]; feedStale?: boolean } = {},
) {
  const byPlayer = new Map<string, unknown>()
  let newest: Date | null = null
  for (const f of facts) {
    const fetchedAt = f.fetchedAt ?? new Date(NOW.getTime() - 60 * 60 * 1000)
    if (!newest || fetchedAt > newest) newest = fetchedAt
    byPlayer.set(normalizeMatchName(f.name), {
      playerName: f.name,
      status: f.status,
      type: null,
      description: null,
      date: null,
      week: null,
      source: 'rolling_insights',
      fetchedAt,
      ageHours: (NOW.getTime() - fetchedAt.getTime()) / 3_600_000,
      stale: f.stale ?? false,
    })
  }
  return {
    byPlayer,
    ambiguous: opts.ambiguous ?? [],
    newestFetchedAt: newest,
    feedStale: opts.feedStale ?? false,
  }
}

const emptyRiResolution = () => riResolution([])

/** Player-record injury context (the fallback source), same shape resolveInjuryContext returns. */
function recordContext(playerId: string, status: string | null, isStale: boolean | null = false) {
  return {
    byId: new Map([
      [
        playerId,
        {
          status,
          availabilityCategory: 'unknown',
          practiceStatus: null,
          gameStatus: null,
          bodyPart: null,
          description: null,
          freshness: { fetchedAt: null, expiresAt: null, updatedAt: '2026-08-10T11:00:00.000Z', isStale, staleReason: null },
          provenance: { source: 'test' },
          resolved: true,
          uncertainty: [],
        },
      ],
    ]),
    resolvedCount: 1,
    unresolvedIds: [],
    warnings: [],
  }
}

async function assemble() {
  const { assembleCrossLeaguePlayerPortfolio } = await import('@/lib/shared-services/league-hub/crossLeaguePlayerPortfolio')
  return assembleCrossLeaguePlayerPortfolio({ appUserId: 'user-1', requestTime: NOW })
}

describe('injury read port wiring (Slice 18)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    userProfileFindUnique.mockResolvedValue({ sleeperUserId: null })
    leagueTeamFindMany.mockResolvedValue([])
    fantasyProjectionFindMany.mockResolvedValue([])
    rosterFindMany.mockResolvedValue([baseRoster()])
    resolvePlayersMock.mockResolvedValue([resolutionFor('p1')])
    resolveInjuryContextMock.mockResolvedValue({ byId: new Map(), resolvedCount: 0, unresolvedIds: [], warnings: [] })
    resolveScheduleContextMock.mockResolvedValue({ byTeam: new Map(), requestedTeams: 0, resolvedTeams: 0, completeness: 0, warnings: [], coverageGaps: [] })
    assembleUserOsRecommendationsMock.mockResolvedValue({
      bundle: { lineup: [], waiver: [], trade: [], roster: [], playoff: [], strategy: [], commissioner: [], totalCount: 0 },
      domainStatus: {},
      generatedAt: '',
      accessDenied: false,
    })
    resolveInjuryFactsMock.mockResolvedValue(emptyRiResolution())
  })

  it('an RI injury row WINS over the player-record token', async () => {
    // Record says Questionable; RI (fresher, real designation) says Out.
    resolveInjuryContextMock.mockResolvedValue(recordContext('p1', 'Questionable'))
    resolveInjuryFactsMock.mockResolvedValue(riResolution([{ name: 'Player p1', status: 'Out' }]))
    const result = await assemble()
    expect(result.items[0].injury?.status).toBe('out')
    expect(result.items[0].injury?.freshness.state).toBe('fresh')
  })

  it('roster tokens (INACT/ACT/Active/NA) NEVER produce an injury severity — including the old NA→out coercion', async () => {
    for (const rosterToken of ['INACT', 'ACT', 'Active', 'NA']) {
      resolveInjuryContextMock.mockResolvedValue(recordContext('p1', rosterToken))
      resolveInjuryFactsMock.mockResolvedValue(emptyRiResolution())
      const result = await assemble()
      // No RI row + a roster token = no injury claim at all. Absence of an
      // injury row means "no news" — NOT "healthy", and never 'out'.
      expect(result.items[0].injury, `token ${rosterToken} must not produce an injury block`).toBeNull()
    }
  })

  it('a stale RI row is carried but FLAGGED — status present, freshness "stale"', async () => {
    resolveInjuryFactsMock.mockResolvedValue(
      riResolution([{ name: 'Player p1', status: 'Questionable', stale: true, fetchedAt: new Date('2026-07-27T12:00:00Z') }]),
    )
    const result = await assemble()
    expect(result.items[0].injury?.status).toBe('questionable')
    expect(result.items[0].injury?.freshness.state).toBe('stale')
  })

  it('a stale FEED flags even a per-row-fresh fact', async () => {
    resolveInjuryFactsMock.mockResolvedValue(
      riResolution([{ name: 'Player p1', status: 'Out' }], { feedStale: true }),
    )
    const result = await assemble()
    expect(result.items[0].injury?.status).toBe('out')
    expect(result.items[0].injury?.freshness.state).toBe('stale')
    expect(result.injuryPort.feedStale).toBe(true)
  })

  it('a null RI designation surfaces as "unknown" — no designation stated is NOT healthy', async () => {
    resolveInjuryFactsMock.mockResolvedValue(riResolution([{ name: 'Player p1', status: null }]))
    const result = await assemble()
    expect(result.items[0].injury?.status).toBe('unknown')
  })

  it('ambiguous[] from the port is reported on the result, not swallowed', async () => {
    resolveInjuryFactsMock.mockResolvedValue(riResolution([], { ambiguous: ['Josh Allen'] }))
    const result = await assemble()
    expect(result.injuryPort.ambiguousPlayers).toContain('Josh Allen')
  })

  it('genuine player-record injury tokens still work as fallback when RI has no row', async () => {
    for (const [token, expected] of [
      ['IR', 'ir'],
      ['Out', 'out'],
      ['Questionable', 'questionable'],
      ['Suspension', 'suspended'],
    ] as const) {
      resolveInjuryContextMock.mockResolvedValue(recordContext('p1', token))
      resolveInjuryFactsMock.mockResolvedValue(emptyRiResolution())
      const result = await assemble()
      expect(result.items[0].injury?.status, `token ${token}`).toBe(expected)
    }
  })

  it('RI designations map to the urgency-severity vocabulary (Out/Doubtful/Questionable/IR/Day-To-Day/Probable)', async () => {
    for (const [designation, expected] of [
      ['Out', 'out'],
      ['Doubtful', 'doubtful'],
      ['Questionable', 'questionable'],
      ['IR', 'ir'],
      ['Day-To-Day', 'day_to_day'],
      // Probable states the player is expected to play — severity none.
      ['Probable', 'healthy'],
    ] as const) {
      resolveInjuryFactsMock.mockResolvedValue(riResolution([{ name: 'Player p1', status: designation }]))
      const result = await assemble()
      expect(result.items[0].injury?.status, designation).toBe(expected)
    }
  })
})
