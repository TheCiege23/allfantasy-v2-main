/**
 * Fantasy OS Suite — Phase OS-A2: League Context Wiring.
 *
 * The Prisma-backed read/write layer over `DecisionOsLeagueContext`, sitting on top of the pure
 * interpretation module (`leagueFinancialContext.ts`) built in Phase OS-A1. Mirrors the honest-
 * degradation pattern already established by `defaultLoadImportedActivityRows`
 * (`lib/decision-os/behavioral/api/real-data-provider.ts`): if the model isn't migrated/generated in
 * a given environment yet, reads degrade to the honest pure default rather than crashing — the OS-A1
 * migration has not been applied to any database as of this phase, so this is the expected path in
 * every real environment today, not a hypothetical.
 *
 * Writes are held to a stricter standard: a confirm/reset action is a real, user-initiated claim, so
 * if the store genuinely isn't available, the caller must be told honestly (a real error), not given
 * a false "confirmed" response that silently didn't persist.
 */
import { prisma as defaultPrisma } from '@/lib/prisma'
import {
  applyManualFinancialConfirmation,
  defaultLeagueFinancialContext,
  resetLeagueFinancialContext,
  type LeagueEscrowProvider,
  type LeagueFinancialConfidence,
  type LeagueFinancialContext,
  type LeagueFinancialStatus,
  type ManualFinancialConfirmationInput,
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
  upsertContext(leagueId: string, context: LeagueFinancialContext): Promise<void>
}

/** Thrown only by `upsertContext` — the model isn't migrated/generated in this environment. Routes
 * should catch this and return an honest 503, never silently swallow it as if the write succeeded. */
export class LeagueContextStoreUnavailableError extends Error {
  constructor() {
    super('DecisionOsLeagueContext store is not available in this environment (not migrated/generated yet).')
    this.name = 'LeagueContextStoreUnavailableError'
  }
}

type LeagueContextDelegate = {
  findUnique(args: { where: { leagueId: string } }): Promise<PersistedLeagueContextRow | null>
  upsert(args: {
    where: { leagueId: string }
    create: Record<string, unknown>
    update: Record<string, unknown>
  }): Promise<unknown>
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

async function defaultUpsertContext(leagueId: string, context: LeagueFinancialContext): Promise<void> {
  const delegate = resolveDelegate()
  if (!delegate) {
    throw new LeagueContextStoreUnavailableError()
  }
  const fields = {
    financialStatus: context.financialStatus,
    buyInAmount: context.buyInAmount,
    buyInCurrency: context.buyInCurrency,
    escrowProvider: context.escrowProvider,
    financialConfidence: context.financialConfidence,
    financialNotes: context.financialNotes,
    isUserConfirmed: context.isUserConfirmed,
    lastVerifiedAt: context.lastVerifiedAt,
  }
  await delegate.upsert({
    where: { leagueId },
    create: { leagueId, ...fields },
    update: fields,
  })
}

const defaultDeps: LeagueContextStoreDeps = {
  findContext: defaultFindContext,
  upsertContext: defaultUpsertContext,
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

export type LeagueFinancialConfirmationAction =
  | { type: 'confirm'; input: ManualFinancialConfirmationInput }
  | { type: 'reset' }

/**
 * Applies a real, user-initiated confirm/reset action and persists it. Reads the current context
 * first (so a confirm action layers onto whatever's already on file, matching
 * `applyManualFinancialConfirmation`'s own "current + input" contract), then writes the result.
 * Throws `LeagueContextStoreUnavailableError` if the store genuinely can't persist — callers must
 * surface that honestly, not report success.
 */
export async function persistLeagueFinancialConfirmation(
  leagueId: string,
  action: LeagueFinancialConfirmationAction,
  deps: LeagueContextStoreDeps = defaultDeps,
  now: Date = new Date(),
): Promise<LeagueFinancialContext> {
  const current = await resolveLeagueFinancialContext(leagueId, deps)
  const next =
    action.type === 'reset'
      ? resetLeagueFinancialContext(leagueId, 'unspecified')
      : applyManualFinancialConfirmation(current, action.input, now)
  await deps.upsertContext(leagueId, next)
  return next
}
