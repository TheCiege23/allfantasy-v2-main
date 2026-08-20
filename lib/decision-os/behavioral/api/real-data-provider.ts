/**
 * Decision OS — Phase 5.8 Intelligence API Real Data Provider.
 *
 * Implements IntelligenceDataProvider by running the full read-only behavioral pipeline:
 *   Phase 5.1 ports → Phase 5.1 mappers → Phase 5.1 assembler → Phase 5.2/5.3/5.4 derivers.
 *
 * Architecture constraints (ADR_F5_8_REAL_DATA_PROVIDER.md):
 * - Read-only: no writes, no upserts, no deletes
 * - Events-derived managerIds: silent managers (zero events in lookback) are not surfaced
 * - Degraded-safe: returns valid (low-completeness) intelligence when data is sparse; never null
 *   for missing events — null is reserved for catastrophic DB failure → 503 INTELLIGENCE_UNAVAILABLE
 * - Tenant isolation: caller's leagueId/managerId is trusted (Phase 5.9+ concern)
 * - Lookback: INTELLIGENCE_LOOKBACK_DAYS env (integer days, default 90, min 1)
 * - Platform cap: INTELLIGENCE_PLATFORM_MAX_LEAGUES env (integer, default 20, min 1)
 */

import type { BehavioralEvent } from '../events/types'
import type {
  RawWaiverClaimRow,
  RawLeagueTradeRow,
  RawRosterMoveRow,
  RawDraftSessionRow,
  RawDraftPickRow,
} from '../port'
import {
  loadWaiverClaimRows  as defaultLoadWaiverClaimRows,
  loadLeagueTradeRows  as defaultLoadLeagueTradeRows,
  loadRosterMoveRows   as defaultLoadRosterMoveRows,
  loadDraftRows        as defaultLoadDraftRows,
  loadLeagueImportSignals as defaultLoadLeagueImportSignals,
} from '../port'
import type { RawImportSignals } from '../port'
import { extendLookbackForImport, type ImportSignalsInput } from '../import-signals'
import {
  mapWaiverClaimsToEvents,
  mapLeagueTradesToEvents,
  mapRosterMovesToEvents,
  mapDraftRowsToEvents,
} from '../mappers'
import { assembleManagerBehavioralFacts, assembleLeagueBehavioralFacts } from '../assemble'
import { deriveManagerBehavioralIntelligence }  from '../manager-intelligence'
import { deriveLeagueBehavioralIntelligence }   from '../league-intelligence'
import { derivePlatformBehavioralIntelligence } from '../platform-intelligence'
import { prisma as defaultPrisma }              from '@/lib/prisma'
import type { IntelligenceDataProvider }        from './intelligence-handlers'
import type { ManagerBehavioralIntelligence }   from '../manager-intelligence'
import type { LeagueBehavioralIntelligence }    from '../league-intelligence'
import type { ImportedActivityEventRow }         from '../importedActivityToEvents'

// ── Configuration (read at call time for env-override support) ────────────────

function lookbackDays(): number {
  return Math.max(1, parseInt(process.env.INTELLIGENCE_LOOKBACK_DAYS    ?? '90', 10) || 90)
}

function maxPlatformLeagues(): number {
  return Math.max(1, parseInt(process.env.INTELLIGENCE_PLATFORM_MAX_LEAGUES ?? '20', 10) || 20)
}

// ── Imported-activity loader (RC1 union — restored after the origin/main merge) ─

/**
 * Default imported-activity loader. Degrades honestly: if the `decisionOsImportedActivity`
 * model isn't generated/migrated yet, returns [] so AF-native behavior is unchanged (never crashes).
 *
 * Restored during the RC1 mainline reconciliation: `dashboard-intelligence.ts` imports this symbol
 * directly to reuse the same honest-degradation logic for its own redraft sources. Only this
 * standalone export is reintroduced — main's provider pipeline is left intact and no other
 * branch-era behavior is restored.
 */
export async function defaultLoadImportedActivityRows(leagueId: string, since?: Date): Promise<ImportedActivityEventRow[]> {
  try {
    const delegate = (defaultPrisma as unknown as {
      decisionOsImportedActivity?: { findMany(args: unknown): Promise<ImportedActivityEventRow[]> }
    })?.decisionOsImportedActivity
    if (!delegate || typeof delegate.findMany !== 'function') return []
    return await delegate.findMany({
      where: {
        OR: [{ afLeagueId: leagueId }, { providerLeagueId: leagueId }],
        ...(since ? { occurredAt: { gte: since } } : {}),
      },
      orderBy: { occurredAt: 'desc' },
    })
  } catch {
    // Model not generated/migrated yet, or read failed → degrade honestly; AF-native reads are unaffected.
    return []
  }
}

// ── Dependency interface ──────────────────────────────────────────────────────

/**
 * Explicit deps for testability — consistent with the project's WaiverLoaderDeps pattern.
 * Default deps use the real Phase 5.1 port functions and the Prisma singleton.
 */
export interface RealDataProviderDeps {
  loadWaiverClaimRows(leagueId: string, since?: Date): Promise<RawWaiverClaimRow[]>
  loadLeagueTradeRows(leagueId: string, since?: Date): Promise<RawLeagueTradeRow[]>
  loadRosterMoveRows(leagueId: string, since?: Date):  Promise<RawRosterMoveRow[]>
  loadDraftRows(leagueId: string): Promise<{
    session: RawDraftSessionRow | null
    picks:   RawDraftPickRow[]
  }>
  /** Read-only: returns league ids ordered most-recent-first, up to `take` entries. */
  findLeagueIds(take: number): Promise<{ id: string }[]>
  /**
   * Phase 5.2 wire-up — read-only Sleeper `ImportRun`/`ImportWarning` signals
   * for a league. Returns an empty shape when no import exists. Overridable
   * for tests. Failures inside the loader are caught by `buildLeaguePipeline`
   * so a resolver hiccup can never fail the intelligence pipeline itself.
   */
  loadLeagueImportSignals(leagueId: string): Promise<RawImportSignals>
}

const defaultDeps: RealDataProviderDeps = {
  loadWaiverClaimRows: defaultLoadWaiverClaimRows,
  loadLeagueTradeRows: defaultLoadLeagueTradeRows,
  loadRosterMoveRows:  defaultLoadRosterMoveRows,
  loadDraftRows:       defaultLoadDraftRows,
  loadLeagueImportSignals: defaultLoadLeagueImportSignals,
  findLeagueIds: (take) =>
    defaultPrisma.league.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true },
    }),
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function sinceDate(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d
}

async function loadAllLeagueEvents(
  leagueId: string,
  since:    Date,
  deps:     RealDataProviderDeps,
): Promise<BehavioralEvent[]> {
  const [waiverRows, tradeRows, rosterMoveRows, draftData] = await Promise.all([
    deps.loadWaiverClaimRows(leagueId, since),
    deps.loadLeagueTradeRows(leagueId, since),
    deps.loadRosterMoveRows(leagueId, since),
    deps.loadDraftRows(leagueId),
  ])
  return [
    ...mapWaiverClaimsToEvents(waiverRows),
    ...mapLeagueTradesToEvents(tradeRows),
    ...mapRosterMovesToEvents(rosterMoveRows),
    ...mapDraftRowsToEvents(draftData.session, draftData.picks),
  ]
}

/**
 * Phase 5.2 — the pure derivation core (kept in a separate helper so it stays
 * unit-testable without any DB access). Consumers pass in already-loaded
 * `events` + optional `importSignals`.
 */
function derivePipeline(
  leagueId:       string,
  events:         BehavioralEvent[],
  lookback:       number,
  importSignals:  ImportSignalsInput | null,
): {
  leagueIntelligence:    LeagueBehavioralIntelligence
  managerIntelligences:  ManagerBehavioralIntelligence[]
} {
  const leagueFacts = assembleLeagueBehavioralFacts({ leagueId, events, lookbackDays: lookback })

  const managerIntelligences: ManagerBehavioralIntelligence[] =
    leagueFacts.activeManagerIds.map((managerId) => {
      const facts = assembleManagerBehavioralFacts({ managerId, leagueId, events, lookbackDays: lookback })
      return deriveManagerBehavioralIntelligence(facts, events)
    })

  const leagueIntelligence = deriveLeagueBehavioralIntelligence(
    leagueFacts,
    managerIntelligences,
    new Date(),
    importSignals,
  )
  return { leagueIntelligence, managerIntelligences }
}

/**
 * Phase 5.2 — orchestrator: loads import signals via the port, extends the
 * lookback if a recent import falls outside it (wire-up A), and calls the
 * pure derivation core. A loader failure is defensively swallowed so the
 * pipeline continues without a dataQuality signal (never `503`s a live-game
 * pipeline because an ImportRun query hiccupped).
 */
async function buildLeaguePipeline(
  leagueId:    string,
  events:      BehavioralEvent[],
  lookback:    number,
  deps:        RealDataProviderDeps,
): Promise<{
  leagueIntelligence:    LeagueBehavioralIntelligence
  managerIntelligences:  ManagerBehavioralIntelligence[]
}> {
  let importSignals: ImportSignalsInput | null = null
  try {
    const raw = await deps.loadLeagueImportSignals(leagueId)
    importSignals = {
      lastImportedAt: raw.lastImportedAt,
      warningCountsBySeverity: raw.warningCountsBySeverity,
      latestRunIncomplete: raw.latestRunIncomplete,
    }
  } catch {
    // Defensive: an ImportRun query failure must never break live-game intelligence.
    importSignals = null
  }
  // Wire-up A — clamp/extend the lookback so a fresh import isn't excluded.
  const effectiveLookback = extendLookbackForImport(
    lookback,
    importSignals?.lastImportedAt ?? null,
  )
  return derivePipeline(leagueId, events, effectiveLookback, importSignals)
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a real IntelligenceDataProvider backed by the Phase 5.1–5.4 pipeline.
 * Pass partial deps overrides for testing; omit to use real port functions + Prisma.
 */
export function createRealDataProvider(
  deps: Partial<RealDataProviderDeps> = {},
): IntelligenceDataProvider {
  const d: RealDataProviderDeps = { ...defaultDeps, ...deps }

  return {
    async getManagerIntelligence(managerId, leagueId) {
      try {
        const lookback = lookbackDays()
        const since    = sinceDate(lookback)
        const events   = await loadAllLeagueEvents(leagueId, since, d)
        const facts    = assembleManagerBehavioralFacts({ managerId, leagueId, events, lookbackDays: lookback })
        return deriveManagerBehavioralIntelligence(facts, events)
      } catch {
        return null
      }
    },

    async getLeagueIntelligence(leagueId) {
      try {
        const lookback = lookbackDays()
        const since    = sinceDate(lookback)
        const events   = await loadAllLeagueEvents(leagueId, since, d)
        const { leagueIntelligence } = await buildLeaguePipeline(leagueId, events, lookback, d)
        return leagueIntelligence
      } catch {
        return null
      }
    },

    async getLeagueManagerIntelligences(leagueId) {
      try {
        const lookback = lookbackDays()
        const since    = sinceDate(lookback)
        const events   = await loadAllLeagueEvents(leagueId, since, d)
        // Reuses the same buildLeaguePipeline getLeagueIntelligence already calls —
        // this is the managerIntelligences half of that pipeline's result, previously
        // computed and discarded. No new derivation, no second computation.
        const { managerIntelligences } = await buildLeaguePipeline(leagueId, events, lookback, d)
        return managerIntelligences
      } catch {
        return null
      }
    },

    async getPlatformIntelligence() {
      try {
        const lookback    = lookbackDays()
        const maxLeagues  = maxPlatformLeagues()
        const since       = sinceDate(lookback)

        const leagues = await d.findLeagueIds(maxLeagues)

        if (leagues.length === 0) {
          return derivePlatformBehavioralIntelligence([], [], [])
        }

        const allLeagueIntelligences:   LeagueBehavioralIntelligence[]   = []
        const allManagerIntelligences:  ManagerBehavioralIntelligence[]  = []
        const allEvents:                BehavioralEvent[]                 = []

        const results = await Promise.allSettled(
          leagues.map(async ({ id: leagueId }) => {
            const events = await loadAllLeagueEvents(leagueId, since, d)
            const pipeline = await buildLeaguePipeline(leagueId, events, lookback, d)
            return { events, ...pipeline }
          }),
        )

        for (const result of results) {
          if (result.status === 'fulfilled') {
            allLeagueIntelligences.push(result.value.leagueIntelligence)
            allManagerIntelligences.push(...result.value.managerIntelligences)
            allEvents.push(...result.value.events)
          }
        }

        return derivePlatformBehavioralIntelligence(allLeagueIntelligences, allManagerIntelligences, allEvents)
      } catch {
        return null
      }
    },
  }
}

/**
 * Default singleton real provider for route file opt-in.
 * Routes currently use stubDataProvider (Phase 5.7); swap to this in Phase 5.9.
 */
export const realDataProvider: IntelligenceDataProvider = createRealDataProvider()
