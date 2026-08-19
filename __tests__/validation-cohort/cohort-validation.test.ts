/**
 * Fantasy OS Suite — Phase V7.1: Decision OS Validation Cohort tests.
 *
 * Fixture/DI only — NO live Sleeper calls (Step 11). Live calls belong to the CLI. Every stage is
 * exercised with an injected fetch that returns canned Sleeper-shaped payloads.
 */
import { describe, expect, it } from 'vitest'
import { normalizeCohort, resolvableCandidates } from '@/lib/validation-cohort/normalizeCohort'
import { classifyArchetypes } from '@/lib/validation-cohort/archetypeClassifier'
import { mapLeagueToFacts, runPool, type SleeperFetch } from '@/lib/validation-cohort/sleeperCohortClient'
import { probeLeague } from '@/lib/validation-cohort/decisionOsProbe'
import { detectLeagueAnomalies, detectCohortAnomalies } from '@/lib/validation-cohort/anomalyDetector'
import { runCohort } from '@/lib/validation-cohort/runCohort'
import type { NormalizedLeagueFacts } from '@/lib/validation-cohort/types'

// ── Step: normalization ───────────────────────────────────────────────────────
describe('cohort normalization', () => {
  it('trims, lowercases, dedupes, and ignores blank lines', () => {
    const out = normalizeCohort(['Alice', 'alice', '  BOB ', '', '   '])
    expect(out.map((a) => a.normalizedUsername)).toEqual(['alice', 'bob'])
    expect(out[0]!.notes.some((n) => n.includes('duplicate'))).toBe(true)
  })

  it('flags non-username lines as ambiguous without guessing', () => {
    const out = normalizeCohort(['My Cool Team', 'The Dynasty League', 'valid_user'])
    const byRaw = Object.fromEntries(out.map((a) => [a.raw, a]))
    expect(byRaw['My Cool Team']!.status).toBe('ambiguous') // whitespace
    expect(byRaw['The Dynasty League']!.status).toBe('ambiguous') // whitespace + name hint
    expect(byRaw['valid_user']!.status).toBe('pending')
    expect(resolvableCandidates(out)).toHaveLength(1)
  })

  it('leaves a clean single token pending (the API is the arbiter — no guessing)', () => {
    // "DynastyLeague" has no separators; it COULD be a real username. Marking it ambiguous would be
    // guessing it is not — forbidden. It stays pending and the resolver lets the Sleeper API decide.
    const out = normalizeCohort(['DynastyLeague', 'realuser99'])
    expect(out.find((a) => a.raw === 'DynastyLeague')!.status).toBe('pending')
    expect(out.find((a) => a.raw === 'realuser99')!.status).toBe('pending')
  })

  it('flags a multi-word league label (whitespace) as ambiguous', () => {
    const out = normalizeCohort(['The Dynasty League'])
    expect(out[0]!.status).toBe('ambiguous')
    expect(out[0]!.notes[0]).toContain('contains-whitespace')
  })
})

// ── Step: bounded concurrency ─────────────────────────────────────────────────
describe('runPool bounded concurrency', () => {
  it('never exceeds the concurrency limit and preserves order', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const items = Array.from({ length: 20 }, (_, i) => i)
    const out = await runPool(items, 3, async (n) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return n * 2
    })
    expect(maxInFlight).toBeLessThanOrEqual(3)
    expect(out).toEqual(items.map((n) => n * 2))
  })
})

// ── Step: provider-neutral mapping + archetypes ───────────────────────────────
const LEAGUE_A = {
  league_id: '1001',
  season: '2024',
  sport: 'nfl',
  total_rosters: 12,
  status: 'complete',
  draft_id: 'd1',
  roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN'],
  settings: { type: 2, playoff_teams: 6, waiver_type: 2 },
  scoring_settings: { bonus_rec_te: 0.5 },
}

function factsFor(over: Partial<NormalizedLeagueFacts> = {}): NormalizedLeagueFacts {
  const base = mapLeagueToFacts({
    league: LEAGUE_A,
    users: [{ user_id: 'u1', is_owner: true }],
    rosters: Array.from({ length: 12 }, () => ({ owner_id: 'x' })),
    transactions: [
      ...Array.from({ length: 20 }, () => ({ type: 'waiver', status: 'complete' })),
      ...Array.from({ length: 15 }, () => ({ type: 'trade', status: 'complete' })),
    ],
    cohortUserId: 'u1',
  })
  return { ...base, ...over }
}

describe('provider-neutral mapping', () => {
  it('maps Sleeper settings to neutral facts and anonymizes the league id', () => {
    const facts = factsFor()
    expect(facts.leagueReference).toMatch(/^lg_[0-9a-f]{10}$/)
    expect(facts.leagueReference).not.toContain('1001')
    expect(facts.formatType).toBe('dynasty')
    expect(facts.hasSuperflex).toBe(true)
    expect(facts.tightEndPremium).toBe(true)
    expect(facts.sourceIsCommissioner).toBe(true)
    expect(facts.draftState).toBe('complete')
    // no raw provider id or name anywhere in the serialized facts
    expect(JSON.stringify(facts)).not.toMatch(/sleeper|1001/i)
  })

  it('classifies archetypes with cited evidence for every tag', () => {
    const tags = classifyArchetypes(factsFor())
    for (const t of tags) expect(t.evidence.length).toBeGreaterThan(0)
    const byDim = Object.fromEntries(tags.map((t) => [t.dimension, t.value]))
    expect(byDim.format).toBe('dynasty')
    expect(byDim.qb).toBe('superflex')
    expect(byDim.tep).toBe('tep-on')
    expect(byDim['trade-activity']).toBe('high') // 15 trades / 12 teams
  })
})

// ── Step: DB-less Decision OS probe reachability ──────────────────────────────
describe('DB-less Decision OS probe', () => {
  it('derives league health (available) and marks manager/trade/waiver db-backed-only', () => {
    const { probes, health } = probeLeague(factsFor())
    expect(health).toBeTruthy()
    const reach = Object.fromEntries(probes.map((p) => [`${p.os}:${p.output}`, p.reachability]))
    expect(reach['commissioner:league-health']).toBe('available')
    expect(reach['manager:championship-trajectory + per-category recommendations']).toBe('db-backed-only')
    expect(reach['waiver:waiver-impact recommendations']).toBe('db-backed-only')
    expect(reach['trade:trade-opportunity recommendations']).toBe('db-backed-only')
  })

  it('does not fabricate db-backed outputs as available', () => {
    const { probes } = probeLeague(factsFor())
    const available = probes.filter((p) => p.reachability === 'available').map((p) => p.os)
    expect(available).not.toContain('manager')
    expect(available).not.toContain('waiver')
  })
})

// ── Step: anomaly detection ───────────────────────────────────────────────────
describe('anomaly detection', () => {
  it('flags implausible health (healthy status, mostly inactive league)', () => {
    const facts = factsFor()
    const inactive: NormalizedLeagueFacts = { ...facts, activeManagers: 3, numTeams: 12 }
    const health = { ...probeLeague(facts).health!, overallStatus: 'healthy' as const }
    const found = detectLeagueAnomalies(inactive, health)
    expect(found.some((f) => f.code === 'implausible-health-classification')).toBe(true)
  })

  it('flags a provider name leaking into normalized output', () => {
    const facts = factsFor()
    const health = { ...probeLeague(facts).health!, summary: 'imported from Sleeper', urgentAlerts: [] as string[] }
    const found = detectLeagueAnomalies(facts, health)
    expect(found.some((f) => f.code === 'provider-string-in-normalized-output')).toBe(true)
  })

  it('flags an identical recommendation appearing across most leagues', () => {
    const facts = factsFor()
    const mk = (ref: string) => ({
      facts: { ...facts, leagueReference: ref },
      health: { ...probeLeague(facts).health!, interventionRecommendations: ['Send a weekly recap'] },
    })
    const found = detectCohortAnomalies([mk('lg_a'), mk('lg_b'), mk('lg_c')])
    expect(found.some((f) => f.code === 'identical-recommendation-across-leagues')).toBe(true)
  })
})

// ── Step: end-to-end run with injected fetch (dedupe, partial failure, determinism) ──
function fakeFetch(): SleeperFetch {
  const leagueA = LEAGUE_A
  const leagueB = { ...LEAGUE_A, league_id: '2002', settings: { type: 0, playoff_teams: 4, waiver_type: 2 }, roster_positions: ['QB', 'RB', 'WR', 'TE', 'BN'], scoring_settings: {}, status: 'in_season' }
  return async <T>(url: string): Promise<T | null> => {
    if (url.endsWith('/user/alice')) return { user_id: 'u1', display_name: 'Alice' } as T
    if (url.endsWith('/user/bob')) return { user_id: 'u2', display_name: 'Bob' } as T
    if (url.endsWith('/user/ghost')) return null // unresolved
    if (url.includes('/user/u1/leagues/')) return [leagueA] as T
    if (url.includes('/user/u2/leagues/')) return [leagueA, leagueB] as T // shares league A → dedupe
    if (url.includes('/league/1001/users') || url.includes('/league/2002/users')) return [{ user_id: 'u1', is_owner: true }] as T
    if (url.includes('/rosters')) return Array.from({ length: 12 }, () => ({ owner_id: 'x' })) as T
    if (url.includes('/transactions/')) return [{ type: 'waiver', status: 'complete' }] as T
    return null
  }
}

describe('runCohort end-to-end (injected fetch)', () => {
  it('resolves, dedupes shared leagues, records unresolved, and is deterministic', async () => {
    const accounts = normalizeCohort(['alice', 'bob', 'ghost', 'My Team Name'])
    const r1 = await runCohort(normalizeCohort(['alice', 'bob', 'ghost', 'My Team Name']), fakeFetch(), { season: '2024', concurrency: 2 })
    const r2 = await runCohort(accounts, fakeFetch(), { season: '2024', concurrency: 2 })

    // alice+bob resolve, ghost unresolved, "My Team Name" ambiguous
    expect(r1.report.accountsResolved).toBe(2)
    expect(r1.report.accountsUnresolved).toBe(1)
    expect(r1.report.accountsAmbiguous).toBe(1)
    // league A surfaced by both accounts → counted once; plus league B = 2 unique
    expect(r1.report.uniqueLeaguesImported).toBe(2)
    // deterministic report (ignoring the timestamp)
    const strip = (r: typeof r1.report) => ({ ...r, generatedAt: '' })
    expect(strip(r1.report)).toEqual(strip(r2.report))
  })

  it('dry-run resolves + discovers but processes no leagues', async () => {
    const { report } = await runCohort(normalizeCohort(['alice', 'bob']), fakeFetch(), { season: '2024', dryRun: true })
    expect(report.perLeague).toHaveLength(0)
    expect(report.uniqueLeaguesImported).toBe(2)
  })

  it('a failing league fetch does not abort the batch', async () => {
    const base = fakeFetch()
    const flaky: SleeperFetch = async <T>(url: string): Promise<T | null> => {
      if (url.includes('/league/2002/rosters')) throw new Error('boom')
      return base<T>(url)
    }
    const { report } = await runCohort(normalizeCohort(['bob']), flaky, { season: '2024', concurrency: 2 })
    // league A still processed even though league B fetch threw
    expect(report.perLeague.length).toBeGreaterThanOrEqual(1)
  })
})
