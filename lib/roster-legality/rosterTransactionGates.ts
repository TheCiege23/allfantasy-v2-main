import type { League } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { parseSettingsSnapshot } from '@/lib/league-contract/types'
import { isElevatedCommissioner } from '@/server/services/permissionService'
import { evaluateLegalityForPersistedRoster } from '@/lib/roster-legality/loadLegalityEvaluationContext'
import { isCommissionerRosterLocked } from '@/lib/league/commissioner-roster-lock'
import { getZombieTradeRestriction } from '@/lib/zombie/zombieTradePolicy'

export type ResolvedRosterTransactionRules = {
  /** Block trades when either party's roster is illegal (settings-driven). */
  illegalRosterBlocksTrades: boolean
  /** Block waiver / add-drop claims when roster is illegal. */
  illegalRosterBlocksWaiverClaims: boolean
  /** When true, head/elevated commissioners bypass the illegal-roster block. */
  illegalRosterCommissionerBypass: boolean
}

/**
 * Reads `League.settings` → `commissionerSettings` / `rosterSettings` (all optional, default off).
 */
export function resolveRosterTransactionRules(league: Pick<League, 'settings'>): ResolvedRosterTransactionRules {
  const snap = parseSettingsSnapshot(league.settings ?? null)
  const comm = (snap?.commissionerSettings ?? {}) as Record<string, unknown>
  const rs = (snap?.rosterSettings ?? {}) as Record<string, unknown>

  return {
    illegalRosterBlocksTrades: Boolean(comm.illegalRosterBlocksTrades ?? rs.illegalRosterBlocksTrades ?? false),
    illegalRosterBlocksWaiverClaims: Boolean(
      comm.illegalRosterBlocksWaiverClaims ??
        comm.illegalRosterBlocksWaivers ??
        rs.illegalRosterBlocksWaiverClaims ??
        false,
    ),
    illegalRosterCommissionerBypass: Boolean(
      comm.illegalRosterCommissionerBypass ?? rs.illegalRosterCommissionerBypass ?? true,
    ),
  }
}

export async function assertRosterTransactionsAllowed(params: {
  leagueId: string
  /** When already loaded (e.g. trade create), avoids an extra query. */
  league?: (Pick<League, 'id' | 'settings'> & Partial<Pick<League, 'leagueVariant'>>) | null
  rosterIds: string[]
  userId: string
  kind: 'trade' | 'waiver_claim'
}): Promise<
  | { ok: true }
  | { ok: false; error: string; code: 'ILLEGAL_ROSTER_BLOCKED' | 'COMMISSIONER_ROSTER_LOCKED' | 'ZOMBIE_TRADE_BLOCKED' | 'ELIMINATED_ROSTER' }
> {
  const league =
    params.league ??
    (await prisma.league.findUnique({ where: { id: params.leagueId }, select: { id: true, settings: true, leagueVariant: true } }))
  if (!league) return { ok: false, error: 'League not found', code: 'ILLEGAL_ROSTER_BLOCKED' }

  const sg = league.leagueVariant === 'survivor_guillotine' || (league.leagueVariant === undefined &&
    !!(await prisma.survivorGuillotineLeague.findUnique({ where: { leagueId: params.leagueId }, select: { id: true } })))
  if (sg && await prisma.survivorGuillotineChop.count({ where: { leagueId: params.leagueId,
    rosterId: { in: params.rosterIds }, reversedAt: null } })) {
    return { ok: false, error: 'An eliminated roster cannot make transactions.', code: 'ELIMINATED_ROSTER' }
  }

  const uniq = [...new Set(params.rosterIds.filter(Boolean))]
  for (const rosterId of uniq) {
    if (await isCommissionerRosterLocked(params.leagueId, rosterId)) {
      return { ok: false, error: 'This roster is locked by the commissioner.', code: 'COMMISSIONER_ROSTER_LOCKED' }
    }
  }

  if (params.kind === 'trade') {
    const restriction = await getZombieTradeRestriction(params.leagueId, uniq)
    if (restriction) {
      return {
        ok: false,
        error: restriction === 'whisperer_trade_blocked'
          ? 'The Whisperer cannot trade after the first infection.'
          : 'Zombies cannot trade in this league.',
        code: 'ZOMBIE_TRADE_BLOCKED',
      }
    }
  }

  const rules = resolveRosterTransactionRules(league)
  const needBlock =
    params.kind === 'trade' ? rules.illegalRosterBlocksTrades : rules.illegalRosterBlocksWaiverClaims
  if (!needBlock) return { ok: true }

  const bypass =
    rules.illegalRosterCommissionerBypass && (await isElevatedCommissioner(params.leagueId, params.userId))
  if (bypass) return { ok: true }

  for (const rosterId of uniq) {
    const roster = await prisma.roster.findFirst({
      where: { id: rosterId, leagueId: params.leagueId },
      select: { id: true, playerData: true },
    })
    if (!roster) continue

    const ev = await evaluateLegalityForPersistedRoster({
      id: roster.id,
      leagueId: params.leagueId,
      playerData: roster.playerData,
    })
    if (ev && !ev.result.isLegal) {
      const msg =
        ev.result.blockingReasons[0]?.message ??
        'Your roster must be legal before this action. Fix IR, taxi, devy, or overflow issues.'
      return { ok: false, error: msg, code: 'ILLEGAL_ROSTER_BLOCKED' }
    }
  }

  return { ok: true }
}
