/**
 * Fantasy OS Suite — Phase V7.1: Decision OS Validation Cohort (orchestrator).
 *
 * Ties the pipeline together: resolve → dedupe leagues → neutral facts → archetypes → DB-less Decision OS
 * probe → per-league + cohort anomalies → deterministic report. Injected `fetchJson` keeps it testable
 * with fixtures and free of any live-API dependency. Partial failures are logged per stage and never abort
 * the batch; already-processed leagues can be skipped for resumability.
 */
import type { ValidationAccount, CohortAggregateReport, LeagueValidationResult, NormalizedLeagueFacts } from './types'
import { resolvableCandidates } from './normalizeCohort'
import {
  resolveUsername,
  fetchUserLeagues,
  fetchLeagueFacts,
  runPool,
  type SleeperFetch,
  type ResolveOptions,
} from './sleeperCohortClient'
import { classifyArchetypes } from './archetypeClassifier'
import { probeLeague } from './decisionOsProbe'
import { detectLeagueAnomalies, detectCohortAnomalies, detectAlwaysEmptyOutputs } from './anomalyDetector'
import { buildLeagueResult, buildAggregate } from './reportBuilder'

export type RunOptions = ResolveOptions & {
  concurrency?: number
  /** League references already processed in a prior run — skipped for resumability. */
  alreadyDone?: Set<string>
  /** When true, resolve + fetch + classify + probe but do not treat it as a persisted run. */
  dryRun?: boolean
  /** Hard cap on unique leagues processed — a bounded-import safeguard (0/undefined = no cap). */
  maxLeagues?: number
}

export type RunResult = {
  accounts: ValidationAccount[]
  report: CohortAggregateReport
}

/** Execute the cohort validation. `accounts` is the normalized registry; only `pending` are resolved. */
export async function runCohort(
  accounts: ValidationAccount[],
  fetchJson: SleeperFetch,
  opts: RunOptions = {},
): Promise<RunResult> {
  const season = opts.season ?? String(new Date().getUTCFullYear())
  const sport = opts.sport ?? 'nfl'
  const concurrency = opts.concurrency ?? 3
  const alreadyDone = opts.alreadyDone ?? new Set<string>()
  const errorsByStage: Record<string, number> = {}
  const bump = (stage: string) => (errorsByStage[stage] = (errorsByStage[stage] ?? 0) + 1)

  // ── Stage 1: resolve usernames ──────────────────────────────────────────────
  const candidates = resolvableCandidates(accounts)
  await runPool(candidates, concurrency, async (acct) => {
    try {
      const resolved = await resolveUsername(acct.normalizedUsername, fetchJson)
      if (!resolved) {
        acct.status = 'unresolved'
        acct.notes.push('Sleeper API returned no account for this username')
        return
      }
      acct.status = 'resolved'
      acct.sleeperUserId = resolved.userId
      acct.displayName = resolved.displayName
    } catch {
      acct.status = 'failed'
      acct.notes.push('error during username resolution')
      bump('resolve')
    }
  })

  // ── Stage 2: gather unique leagues across all resolved accounts ──────────────
  type LeagueTask = { league: Awaited<ReturnType<typeof fetchUserLeagues>>[number]; cohortUserId: string }
  const seenLeagueIds = new Set<string>()
  const tasks: LeagueTask[] = []
  for (const acct of accounts.filter((a) => a.status === 'resolved' && a.sleeperUserId)) {
    try {
      const leagues = await fetchUserLeagues(acct.sleeperUserId!, season, sport, fetchJson)
      for (const league of leagues) {
        if (seenLeagueIds.has(league.league_id)) continue // dedupe: same league surfaced by multiple accounts
        seenLeagueIds.add(league.league_id)
        tasks.push({ league, cohortUserId: acct.sleeperUserId! })
      }
    } catch {
      bump('fetch-leagues')
    }
  }

  // Bounded-import safeguard: cap the number of unique leagues actually processed.
  const capped = opts.maxLeagues && opts.maxLeagues > 0 ? tasks.slice(0, opts.maxLeagues) : tasks

  // Dry-run: stop after discovery. Resolve accounts + count unique leagues that WOULD be processed,
  // without any heavy per-league fetch/derivation. A distinct signal that no full run happened.
  if (opts.dryRun) {
    const report = buildAggregate({ accounts, perLeague: [], cohortAnomalies: [], errorsByStage })
    report.uniqueLeaguesImported = tasks.length
    return { accounts, report }
  }

  // ── Stage 3: per-league facts → classify → probe → anomalies ────────────────
  const perLeague: LeagueValidationResult[] = []
  const healthForCohort: { facts: NormalizedLeagueFacts; health: NonNullable<ReturnType<typeof probeLeague>['health']> }[] = []

  await runPool(capped, concurrency, async (task) => {
    let facts: NormalizedLeagueFacts | null = null
    try {
      facts = await fetchLeagueFacts(task.league, task.cohortUserId, fetchJson, opts)
    } catch {
      bump('fetch-league-facts')
      return
    }
    if (alreadyDone.has(facts.leagueReference)) return // resumability

    try {
      const archetypes = classifyArchetypes(facts)
      const { probes, health } = probeLeague(facts)
      const anomalies = health ? detectLeagueAnomalies(facts, health) : []
      perLeague.push(
        buildLeagueResult({ facts, archetypes, probes, anomalies, warnings: [], derivationFailed: !health }),
      )
      if (health) healthForCohort.push({ facts, health })
    } catch {
      bump('derive')
      perLeague.push(
        buildLeagueResult({
          facts,
          archetypes: [],
          probes: [],
          anomalies: [],
          warnings: ['derivation threw'],
          derivationFailed: true,
        }),
      )
    }
  })

  // Stable ordering for deterministic reports.
  perLeague.sort((a, b) => a.leagueReference.localeCompare(b.leagueReference))

  // ── Stage 4: cohort-level anomalies + aggregate ─────────────────────────────
  const cohortAnomalies = [...detectCohortAnomalies(healthForCohort), ...detectAlwaysEmptyOutputs(perLeague)]
  const report = buildAggregate({ accounts, perLeague, cohortAnomalies, errorsByStage })

  return { accounts, report }
}
