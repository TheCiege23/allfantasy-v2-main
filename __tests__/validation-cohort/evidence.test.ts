/**
 * Fantasy OS Suite — Phase V8.2: historical evidence expansion tests.
 *
 * Fixture/DI only — no live Sleeper calls. Covers provider-neutral normalization, bounded fetch + the
 * five-way category status, activity derivation, integrity severity + bundle-level checks, and Decision OS
 * read-compatibility across the seven Operating Systems.
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeRosters,
  normalizeTransaction,
  normalizeMatchupWeek,
  fetchLeagueEvidence,
} from '@/lib/validation-cohort/evidence/fetchEvidence'
import { deriveActivityEvidence } from '@/lib/validation-cohort/evidence/activityEvidence'
import { buildLeagueReadModel, buildPlatformReadModel } from '@/lib/validation-cohort/evidence/decisionOsReadModel'
import { checkEvidenceIntegrity, summarizeIntegrityBySeverity } from '@/lib/validation-cohort/persistence/integrityChecker'
import type { SleeperFetch } from '@/lib/validation-cohort/sleeperCohortClient'
import type { PersistedLeagueEvidence } from '@/lib/validation-cohort/persistence/evidenceStore'
import type { LeagueEvidenceBundle } from '@/lib/validation-cohort/evidence/contracts'

describe('provider-neutral normalizers', () => {
  it('maps rosters to membership + standings without provider ids', () => {
    const { membership, standings } = normalizeRosters([
      { roster_id: 1, owner_id: 'u1', players: ['p1', 'p2'], starters: ['p1'], settings: { wins: 5, losses: 2, fpts: 1200, fpts_decimal: 50 } },
      { roster_id: 2, owner_id: null, players: [], starters: [], settings: { wins: 2, losses: 5 } },
    ])
    expect(membership[0]).toEqual({ rosterId: 1, hasOwner: true, playerCount: 2, starterCount: 1 })
    expect(membership[1]!.hasOwner).toBe(false)
    expect(standings[0]!.pointsFor).toBeCloseTo(1200.5)
    expect(JSON.stringify({ membership, standings })).not.toMatch(/u1|sleeper/i)
  })

  it('classifies transactions and extracts FAAB only from waiver bids', () => {
    expect(normalizeTransaction(3, { type: 'trade', status: 'complete', roster_ids: [2, 1], adds: { p1: 1 }, drops: { p2: 2 } })).toMatchObject({ type: 'trade', participatingRosterIds: [1, 2], addsCount: 1, dropsCount: 1, faabSpent: null })
    expect(normalizeTransaction(3, { type: 'waiver', status: 'complete', roster_ids: [1], settings: { waiver_bid: 12 } })!.faabSpent).toBe(12)
    expect(normalizeTransaction(3, { type: 'trade', status: 'processing' })).toBeNull() // not complete
  })

  it('maps a matchup week', () => {
    expect(normalizeMatchupWeek(4, [{ roster_id: 1, points: 88.5, matchup_id: 2 }])).toEqual([{ week: 4, rosterId: 1, points: 88.5, matchupId: 2 }])
  })
})

function evidenceFetch(): SleeperFetch {
  return async <T>(url: string): Promise<T | null> => {
    if (url.endsWith('/rosters')) return [
      { roster_id: 1, owner_id: 'u1', players: ['p1', 'p2'], starters: ['p1'], settings: { wins: 5, losses: 2, fpts: 1200 } },
      { roster_id: 2, owner_id: 'u2', players: ['p3'], starters: ['p3'], settings: { wins: 2, losses: 5 } },
    ] as T
    if (url.includes('/matchups/1')) return [{ roster_id: 1, points: 100, matchup_id: 1 }, { roster_id: 2, points: 90, matchup_id: 1 }] as T
    if (url.includes('/matchups/')) return [] as T
    if (url.includes('/transactions/1')) return [
      { type: 'trade', status: 'complete', leg: 1, roster_ids: [1, 2], adds: { p1: 1 }, drops: { p2: 2 } },
      { type: 'waiver', status: 'complete', roster_ids: [1], adds: { p3: 1 }, settings: { waiver_bid: 15 } },
    ] as T
    if (url.includes('/transactions/')) return [] as T
    if (url.endsWith('/drafts')) return [{ draft_id: 'd1', status: 'complete', settings: { rounds: 15 } }] as T
    if (url.includes('/draft/d1/picks')) return [{ roster_id: 1 }, { roster_id: 2 }] as T
    if (url.endsWith('/winners_bracket')) return [{ w: 1, l: 2, p: 1 }] as T
    if (url.endsWith('/losers_bracket')) return null
    return null
  }
}

describe('fetchLeagueEvidence — bounded fetch + five-way status', () => {
  it('normalizes every category with honest status', async () => {
    const b = await fetchLeagueEvidence('L1', evidenceFetch(), { maxWeeks: 3 })
    expect(b.status.rosters).toBe('data')
    expect(b.status.standings).toBe('data')
    expect(b.status.matchups).toBe('data')
    expect(b.status.trades).toBe('data')
    expect(b.status.waivers).toBe('data')
    expect(b.status.free_agents).toBe('empty') // fetched, none present
    expect(b.status.faab).toBe('data')
    expect(b.status.drafts).toBe('data')
    expect(b.transactions).toHaveLength(2)
    expect(b.checkpoints).toEqual({ latestMatchupWeek: 1, latestTransactionWeek: 1, draftComplete: true })
    expect(b.postseason.length).toBeGreaterThan(0)
    // no provider identifiers in the normalized bundle
    expect(JSON.stringify(b)).not.toMatch(/u1|u2|d1|sleeper/i)
  })
})

describe('deriveActivityEvidence', () => {
  it('derives only deterministic evidence (no inference)', async () => {
    const b = await fetchLeagueEvidence('L1', evidenceFetch(), { maxWeeks: 3 })
    const a = deriveActivityEvidence(b)
    expect(a.totalCompletedTrades).toBe(1)
    expect(a.managersParticipatingInTrades).toBe(2)
    expect(a.waiverFrequency).toBe(1)
    expect(a.completedFaabSpending).toBe(15)
    expect(a.rosterChurn).toBe(3) // trade 1+1, waiver 1+0
    expect(a.lineupParticipationRate).toBe(1) // both week-1 entries scored > 0
    expect(a.draftParticipation).toEqual({ present: true, complete: true, participatingRosterCount: 2 })
    expect(a.inactiveRosterCount).toBe(0)
  })
})

// Bundle-backed persisted-evidence fixtures for integrity + compat.
async function persisted(): Promise<PersistedLeagueEvidence> {
  const bundle = await fetchLeagueEvidence('L1', evidenceFetch(), { maxWeeks: 3 })
  return {
    leagueReference: 'lg_ev', season: '2023', sport: 'NFL', previousLeagueRef: null, role: 'commissioner',
    facts: {
      leagueReference: 'lg_ev', season: '2023', sport: 'NFL', formatType: 'redraft', numTeams: 2,
      hasSuperflex: false, hasIdp: false, tightEndPremium: false, playoffTeams: 2, waiverType: 'FAAB',
      totalTrades: 1, totalWaiverClaims: 1, totalTransactions: 2, draftState: 'complete',
      sourceIsCommissioner: true, activeManagers: 2, inactiveManagers: 0,
    },
    evidence: {}, bundle, activity: deriveActivityEvidence(bundle), seasonImmutable: true, importedAt: 'now',
  }
}

describe('integrity severity + bundle-level checks', () => {
  it('classifies findings by severity and flags impossible roster references', async () => {
    const ev = await persisted()
    // corrupt: a transaction references a roster not in membership
    const corrupt: LeagueEvidenceBundle = { ...ev.bundle!, transactions: [{ type: 'trade', week: 1, participatingRosterIds: [99], addsCount: 1, dropsCount: 0, faabSpent: null }] }
    const findings = checkEvidenceIntegrity([{ ...ev, bundle: corrupt }], [{ accountReference: 'a', seasonsDiscovered: ['2023'], leagueRefs: ['lg_ev'], updatedAt: 'now' }])
    expect(findings.some((f) => f.code === 'impossible-roster-reference' && f.severity === 'corrupt-persisted-evidence')).toBe(true)
    const sev = summarizeIntegrityBySeverity(findings)
    expect(sev['corrupt-persisted-evidence']).toBeGreaterThan(0)
  })

  it('a clean bundle-backed corpus yields no findings', async () => {
    const ev = await persisted()
    expect(checkEvidenceIntegrity([ev], [{ accountReference: 'a', seasonsDiscovered: ['2023'], leagueRefs: ['lg_ev'], updatedAt: 'now' }])).toEqual([])
  })
})

describe('Decision OS read-compatibility (Part 7)', () => {
  it('the expanded corpus feeds all seven Operating Systems', async () => {
    const ev = await persisted()
    const perOs = Object.fromEntries(buildLeagueReadModel(ev).map((c) => [c.os, c.available]))
    for (const os of ['commissioner', 'league', 'manager', 'trade', 'waiver', 'draft']) expect(perOs[os], os).toBe(true)
    expect(buildPlatformReadModel([ev]).available).toBe(true)
  })
})
