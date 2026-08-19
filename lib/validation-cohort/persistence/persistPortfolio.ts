/**
 * Fantasy OS Suite — Phase V8.1: portfolio persistence orchestrator.
 *
 * Turns discovery into a persisted, provider-neutral evidence corpus: resolve → enumerate bounded seasons
 * → plan sync (immutable completed seasons / incremental current) → fetch neutral facts for the leagues
 * that need import → upsert into the store → update restartable import state. Reuses the V7.1 resolver +
 * fetch and the V7.2 discovery boundary; it does NOT duplicate the product's operational import.
 *
 * Bounded (explicit season list + concurrency + optional maxLeagues), idempotent (immutable seasons are
 * written once), restartable (import state persisted, already-stored immutable leagues skipped), and
 * partial-failure tolerant (a per-league failure is recorded, never aborts the batch).
 */
import type { ValidationAccount, DiscoveredLeague } from '../types'
import { resolvableCandidates } from '../normalizeCohort'
import {
  resolveUsername,
  fetchUserLeagues,
  fetchLeagueFacts,
  runPool,
  type SleeperFetch,
} from '../sleeperCohortClient'
import { anonymizeLeagueId, anonymizeAccount } from '../anonymize'
import { planSync, isCompletedSeason } from './syncPlanner'
import { fetchLeagueEvidence } from '../evidence/fetchEvidence'
import { deriveActivityEvidence } from '../evidence/activityEvidence'
import type { LeagueEvidenceBundle } from '../evidence/contracts'
import type { EvidenceCategory } from '../types'
import type { HistoricalEvidenceStore, PersistedLeagueEvidence } from './evidenceStore'

/** Map a bundle's per-category fetch status to the boolean "observed" coverage flags. */
function evidenceFlagsFromBundle(bundle: LeagueEvidenceBundle): Partial<Record<EvidenceCategory, boolean>> {
  const flags: Partial<Record<EvidenceCategory, boolean>> = {}
  for (const [cat, status] of Object.entries(bundle.status)) {
    // "observed" = actually fetched (data or a genuine empty), NOT unavailable/not-fetched.
    if (status === 'data' || status === 'empty' || status === 'partial') flags[cat as EvidenceCategory] = true
  }
  return flags
}

export type PersistOptions = {
  seasons: string[]
  currentSeason: string
  sport?: string
  concurrency?: number
  maxLeaguesPerAccount?: number
  maxTxWeeks?: number
  /** V8.2: also fetch + normalize + derive the full evidence bundle (rosters/matchups/transactions/…). */
  importEvidence?: boolean
  /** Bounded week cap for the evidence bundle fetch. */
  evidenceWeeks?: number
}

export type PersistResult = {
  accounts: ValidationAccount[]
  imported: number
  skippedImmutable: number
  partialFailures: number
}

type RawLeague = { league_id: string; season: string; sport?: string; previous_league_id?: string | null }

/** Persist the discovered portfolio evidence for a normalized cohort into the given store. */
export async function persistPortfolio(
  accounts: ValidationAccount[],
  fetchJson: SleeperFetch,
  store: HistoricalEvidenceStore,
  opts: PersistOptions,
): Promise<PersistResult> {
  const sport = opts.sport ?? 'nfl'
  const concurrency = opts.concurrency ?? 3
  const startedAt = Date.now()
  const state = await store.readImportState()
  state.lastAttemptedSync = new Date().toISOString()

  let imported = 0
  let skippedImmutable = 0
  const seasonsTouched = new Set<string>(state.importedSeasons)

  for (const acct of resolvableCandidates(accounts)) {
    const resolved = await resolveUsername(acct.normalizedUsername, fetchJson).catch(() => null)
    if (!resolved) {
      acct.status = 'unresolved'
      acct.notes.push('Sleeper API returned no account for this username')
      continue
    }
    acct.status = 'resolved'
    const userId = resolved.userId
    acct.sleeperUserId = userId

    // Enumerate bounded seasons → raw leagues (dedupe by id).
    const rawById = new Map<string, RawLeague>()
    for (const season of opts.seasons) {
      try {
        const leagues = (await fetchUserLeagues(userId, season, sport, fetchJson)) as unknown as RawLeague[]
        for (const lg of leagues) if (!rawById.has(lg.league_id)) rawById.set(lg.league_id, lg)
      } catch {
        state.partialFailures.push({ stage: 'enumerate-seasons', message: `season ${season} fetch failed` })
      }
    }

    // Plan sync over the anonymized discovery view.
    const discovered: DiscoveredLeague[] = [...rawById.values()].map((lg) => ({
      leagueReference: anonymizeLeagueId(lg.league_id),
      season: lg.season,
      sport: (lg.sport ?? sport).toUpperCase(),
      previousLeagueRef: lg.previous_league_id ? anonymizeLeagueId(lg.previous_league_id) : null,
      role: 'unknown',
    }))
    const alreadyStored = new Set<string>()
    for (const d of discovered) if (await store.hasLeague(d.leagueReference)) alreadyStored.add(d.leagueReference)
    const plan = planSync(discovered, alreadyStored, opts.currentSeason)
    skippedImmutable += plan.skippedCount

    // Fetch facts + persist for the leagues that need import (bounded).
    const refToRaw = new Map<string, RawLeague>()
    for (const lg of rawById.values()) refToRaw.set(anonymizeLeagueId(lg.league_id), lg)
    let toImport = plan.toImport
    if (opts.maxLeaguesPerAccount && opts.maxLeaguesPerAccount > 0) toImport = toImport.slice(0, opts.maxLeaguesPerAccount)

    const results = await runPool(toImport, concurrency, async (league): Promise<boolean> => {
      const raw = refToRaw.get(league.leagueReference)
      if (!raw) return false
      try {
        const facts = await fetchLeagueFacts(raw as never, userId, fetchJson, { maxTxWeeks: opts.maxTxWeeks })
        const completed = isCompletedSeason(league.season, opts.currentSeason)

        // V8.2: optionally gather the full normalized evidence bundle + derived activity.
        let bundle: LeagueEvidenceBundle | undefined
        let activityDerived: ReturnType<typeof deriveActivityEvidence> | undefined
        if (opts.importEvidence) {
          bundle = await fetchLeagueEvidence(raw.league_id, fetchJson, { maxWeeks: opts.evidenceWeeks ?? opts.maxTxWeeks })
          activityDerived = deriveActivityEvidence(bundle)
        }

        const evidence: PersistedLeagueEvidence = {
          leagueReference: facts.leagueReference,
          season: facts.season,
          sport: facts.sport,
          previousLeagueRef: league.previousLeagueRef,
          role: facts.sourceIsCommissioner ? 'commissioner' : 'member',
          facts,
          // Coverage flags: from the full bundle when imported, else the summary-level categories.
          evidence: bundle
            ? { ...evidenceFlagsFromBundle(bundle), previous_league: league.previousLeagueRef !== null }
            : {
                metadata: true,
                rosters: true,
                trades: true,
                waivers: true,
                free_agents: true,
                previous_league: league.previousLeagueRef !== null,
              },
          bundle,
          activity: activityDerived,
          seasonImmutable: completed,
          importedAt: new Date().toISOString(),
        }
        await store.upsertLeagueEvidence(evidence)
        seasonsTouched.add(facts.season)
        state.importedTransactions += facts.totalTransactions
        return true
      } catch {
        state.partialFailures.push({ stage: 'import-league', ref: league.leagueReference, message: 'facts fetch/persist failed' })
        return false
      }
    })
    imported += results.filter(Boolean).length

    // Portfolio records the leagues actually PERSISTED for this account (present in the corpus) — not
    // every discovered league. This keeps integrity checks meaningful under bounded/incremental import.
    const persistedRefs: string[] = []
    for (const d of discovered) if (await store.hasLeague(d.leagueReference)) persistedRefs.push(d.leagueReference)
    await store.upsertPortfolio({
      accountReference: anonymizeAccount(userId),
      seasonsDiscovered: [...new Set(discovered.map((d) => d.season))].sort(),
      leagueRefs: persistedRefs.sort(),
      updatedAt: new Date().toISOString(),
    })
  }

  state.importedLeagues += imported
  state.skippedRecords += skippedImmutable
  state.importedSeasons = [...seasonsTouched].sort()
  state.lastSyncDurationMs = Date.now() - startedAt
  state.lastSuccessfulSync = new Date().toISOString()
  await store.writeImportState(state)

  return { accounts, imported, skippedImmutable, partialFailures: state.partialFailures.length }
}
