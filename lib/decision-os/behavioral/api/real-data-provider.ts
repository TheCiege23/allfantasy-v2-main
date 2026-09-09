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
} from '../port'
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
import { mapImportedActivityRowsToEvents }       from '../importedActivityToEvents'
import type { ImportedActivityEventRow }         from '../importedActivityToEvents'

// ── Configuration (read at call time for env-override support) ────────────────

/**
 * The rolling window every behavioral KPI is computed over.
 *
 * Exported so Commissioner OS can LABEL its KPIs with the window that produced them without
 * restating `90` in the UI. Two statements of one rule is the bug this repo has already paid
 * for elsewhere; a second literal would silently disagree the day this env var is tuned.
 */
export function lookbackDays(): number {
  return Math.max(1, parseInt(process.env.INTELLIGENCE_LOOKBACK_DAYS    ?? '90', 10) || 90)
}

function maxPlatformLeagues(): number {
  return Math.max(1, parseInt(process.env.INTELLIGENCE_PLATFORM_MAX_LEAGUES ?? '20', 10) || 20)
}

// ── Imported-activity loader (RC1 union — restored after the origin/main merge) ─

/**
 * The provider identity of an AF league, for the shared-league arm of the activity query.
 *
 * 🛑 ONE SLEEPER LEAGUE PRODUCES ONE AF `leagues` ROW **PER IMPORTING USER**, AND ONLY ONE OF
 * THEM EVER HOLDS THE ACTIVITY. This is not a duplicate-import bug and must not be "fixed" by
 * deduping leagues — two members of the same league both connecting it is the expected,
 * supported case. Each gets their own `leagues` row with their own `userId`, and both rows
 * carry the SAME `platformLeagueId`.
 *
 * `DecisionOsImportedActivity.externalSourceKey` is globally `@unique` and is derived from the
 * PROVIDER event, not from the AF league. So whichever AF league row the ingest cron reaches
 * first claims every event; for every other row the idempotent writer's dedupe is a permanent
 * no-op. Without this arm, a query keyed on `afLeagueId` returns zero for those rows forever,
 * and the existing `providerLeagueId: leagueId` arm cannot help — it compares an AF UUID
 * against a Sleeper numeric id, which never matches.
 *
 * Measured on prod 2026-09-07: 23 Sleeper leagues are imported by more than one user, giving
 * 54 AF league rows, of which **34 held zero imported activity** while a sibling row holding
 * the same league's real history sat right beside them. Every surface reading through this
 * loader — Commissioner OS, Commissioner Hub, Dashboard Overview, LeagueTab — showed those 34
 * as dormant leagues with no managers and no trades.
 *
 * Returns null when the league is unknown or has no provider identity, which collapses this
 * to exactly the previous behaviour.
 */
async function resolveProviderLeagueSource(
  leagueId: string,
): Promise<{ provider: string; providerLeagueId: string } | null> {
  try {
    const league = await defaultPrisma.league.findUnique({
      where: { id: leagueId },
      select: { platform: true, platformLeagueId: true },
    })
    if (!league?.platform || !league.platformLeagueId) return null
    return { provider: league.platform, providerLeagueId: league.platformLeagueId }
  } catch {
    return null
  }
}

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

    const source = await resolveProviderLeagueSource(leagueId)

    return await delegate.findMany({
      where: {
        OR: [
          { afLeagueId: leagueId },
          { providerLeagueId: leagueId },
          // The shared-league arm — see `resolveProviderLeagueSource`. Scoped by BOTH
          // provider and providerLeagueId so a Sleeper id can never match an ESPN league
          // that happens to carry the same digits.
          ...(source ? [{ provider: source.provider, providerLeagueId: source.providerLeagueId }] : []),
        ],
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
  /** Imported/external-league activity (Sleeper, Yahoo, ESPN, …) — see `defaultLoadImportedActivityRows`. */
  loadImportedActivityRows(leagueId: string, since?: Date): Promise<ImportedActivityEventRow[]>
  /** Read-only: returns league ids ordered most-recent-first, up to `take` entries. */
  findLeagueIds(take: number): Promise<{ id: string }[]>
}

const defaultDeps: RealDataProviderDeps = {
  loadWaiverClaimRows: defaultLoadWaiverClaimRows,
  loadLeagueTradeRows: defaultLoadLeagueTradeRows,
  loadRosterMoveRows:  defaultLoadRosterMoveRows,
  loadDraftRows:       defaultLoadDraftRows,
  loadImportedActivityRows: defaultLoadImportedActivityRows,
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

/**
 * Merges AF-native events with imported/external-league activity (Decision OS Phase A) via the
 * SAME `loadImportedActivityRows`/`mapImportedActivityRowsToEvents` pair `dashboard-intelligence.ts`'s
 * `loadLeagueEvents` already uses for Commissioner Hub / Dashboard Overview / LeagueTab. Without this,
 * a Sleeper/Yahoo/ESPN-imported league — whose trades/waivers/roster moves never touch AF's own
 * `WaiverClaim`/`AfLeagueTrade`/`AfRosterMoveHistory` tables — reads as zero engagement here even
 * when `decision_os_imported_activity` holds its real history. Purely additive; degrades to `[]`
 * honestly when no imported activity exists (never fabricated).
 */
async function loadAllLeagueEvents(
  leagueId: string,
  since:    Date,
  deps:     RealDataProviderDeps,
): Promise<BehavioralEvent[]> {
  const [waiverRows, tradeRows, rosterMoveRows, draftData, importedActivityRows] = await Promise.all([
    deps.loadWaiverClaimRows(leagueId, since),
    deps.loadLeagueTradeRows(leagueId, since),
    deps.loadRosterMoveRows(leagueId, since),
    deps.loadDraftRows(leagueId),
    deps.loadImportedActivityRows(leagueId, since),
  ])
  return [
    ...mapWaiverClaimsToEvents(waiverRows),
    ...mapLeagueTradesToEvents(tradeRows),
    ...mapRosterMovesToEvents(rosterMoveRows),
    ...mapDraftRowsToEvents(draftData.session, draftData.picks),
    ...mapImportedActivityRowsToEvents(importedActivityRows).events,
  ]
}

/**
 * Exported so the scheduled snapshot job can derive league intelligence from the SAME event
 * stream and the SAME rules this API serves, rather than growing a second implementation of
 * "what is this league's engagement score". Two implementations of one rule is the bug; the
 * fix is one of them, not a better copy.
 */
export function buildLeaguePipeline(
  leagueId:    string,
  events:      BehavioralEvent[],
  lookback:    number,
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

  const leagueIntelligence = deriveLeagueBehavioralIntelligence(leagueFacts, managerIntelligences)
  return { leagueIntelligence, managerIntelligences }
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
        const { leagueIntelligence } = buildLeaguePipeline(leagueId, events, lookback)
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
        const { managerIntelligences } = buildLeaguePipeline(leagueId, events, lookback)
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
            const pipeline = buildLeaguePipeline(leagueId, events, lookback)
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
