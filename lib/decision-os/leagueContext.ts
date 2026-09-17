/**
 * Fantasy OS Suite — Phase OS-A2: League Context Wiring.
 *
 * The Prisma-backed READ layer over `DecisionOsLeagueContext`, sitting on top of the pure
 * interpretation module (`leagueFinancialContext.ts`) built in Phase OS-A1. Mirrors the honest-
 * degradation pattern already established by `defaultLoadImportedActivityRows`
 * (`lib/decision-os/behavioral/api/real-data-provider.ts`): if the model isn't migrated/generated in
 * a given environment yet, reads degrade to the honest pure default rather than crashing.
 *
 * The write half — `persistLeagueFinancialConfirmation` and the store-unavailable error it threw, so
 * that a confirm which did not persist could never be reported as success — was removed on
 * 2026-09-17 together with `/api/decision-os/league-context`, its only caller. That route's own only
 * caller was the League Context card, which went with the retired `/commissioner-hub` page. Rows
 * already on file still read; nothing writes one today. A commissioner surface that wants
 * confirm/reset back needs a new entry point, and the pure `applyManualFinancialConfirmation` /
 * `resetLeagueFinancialContext` it would build on are still in `leagueFinancialContext.ts`.
 */
import { prisma as defaultPrisma } from '@/lib/prisma'
import {
  defaultLeagueFinancialContext,
  type LeagueEscrowProvider,
  type LeagueFinancialConfidence,
  type LeagueFinancialContext,
  type LeagueFinancialStatus,
} from './leagueFinancialContext'

interface PersistedLeagueContextRow {
  leagueId: string
  financialStatus: LeagueFinancialStatus
  buyInAmount: number | null
  buyInCurrency: string | null
  escrowProvider: LeagueEscrowProvider
  financialConfidence: LeagueFinancialConfidence
  financialNotes: string | null
  isUserConfirmed: boolean
  lastVerifiedAt: Date | null
}

export interface LeagueContextStoreDeps {
  findContext(leagueId: string): Promise<PersistedLeagueContextRow | null>
}

type LeagueContextDelegate = {
  findUnique(args: { where: { leagueId: string } }): Promise<PersistedLeagueContextRow | null>
}

function resolveDelegate(): LeagueContextDelegate | null {
  const delegate = (defaultPrisma as unknown as { decisionOsLeagueContext?: LeagueContextDelegate })
    ?.decisionOsLeagueContext
  return delegate ?? null
}

async function defaultFindContext(leagueId: string): Promise<PersistedLeagueContextRow | null> {
  try {
    const delegate = resolveDelegate()
    if (!delegate) return null
    return await delegate.findUnique({ where: { leagueId } })
  } catch {
    // Model not generated/migrated yet, or a genuine read failure — degrade honestly to "no row".
    return null
  }
}

const defaultDeps: LeagueContextStoreDeps = {
  findContext: defaultFindContext,
}

function rowToContext(row: PersistedLeagueContextRow): LeagueFinancialContext {
  return {
    leagueId: row.leagueId,
    financialStatus: row.financialStatus,
    buyInAmount: row.buyInAmount,
    buyInCurrency: row.buyInCurrency,
    escrowProvider: row.escrowProvider,
    financialConfidence: row.financialConfidence,
    financialNotes: row.financialNotes,
    isUserConfirmed: row.isUserConfirmed,
    lastVerifiedAt: row.lastVerifiedAt,
  }
}

/**
 * Read-only. Never throws — a missing row, a missing delegate, or a genuine read failure all degrade
 * to the same honest, fully-`UNKNOWN` default a freshly-imported league would have. `provider` is not
 * exposed as a parameter here: the pure default is identical for every provider (see Phase OS-A1's
 * own tests), so passing a fixed, honest placeholder is never misleading.
 */
export async function resolveLeagueFinancialContext(
  leagueId: string,
  deps: LeagueContextStoreDeps = defaultDeps,
): Promise<LeagueFinancialContext> {
  try {
    const row = await deps.findContext(leagueId)
    if (!row) return defaultLeagueFinancialContext(leagueId, 'unspecified')
    return rowToContext(row)
  } catch {
    return defaultLeagueFinancialContext(leagueId, 'unspecified')
  }
}

/**
 * Phase OS-B4.5: shared defense-in-depth wrapper — `resolveLeagueFinancialContext` above already never
 * throws on its own, but every per-league Decision OS composition that reads League Context treats it
 * the same way anyway (`resolveLeagueSafely`'s identical precedent for Mission Control). Was previously
 * a module-private copy in both `attentionQueue.ts` and `commissionerCommandCenter.ts`; consolidated
 * here once `platformOs.ts` needed a third copy (the same "rule of three" reasoning `SEVERITY_DOT_CLASS`
 * was consolidated under in OS-B4). Returns `null` (never throws) on any failure.
 */
export async function resolveLeagueFinancialContextSafely(
  leagueId: string,
  deps: LeagueContextStoreDeps = defaultDeps,
): Promise<LeagueFinancialContext | null> {
  try {
    return await resolveLeagueFinancialContext(leagueId, deps)
  } catch {
    return null
  }
}
