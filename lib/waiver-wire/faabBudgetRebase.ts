/**
 * A FAAB budget change reaches the teams' balances (2026-11-15).
 *
 * 🛑 CHANGING THE BUDGET CHANGED NOTHING ANYONE COULD BID. `seedNullFaabBalances` gives a team the budget only while
 * its balance is NULL, so once a league was seeded a commissioner who raised $100 to $200 saw $200 in settings while
 * every team still had $100 to spend — and lowering it left teams with money the league no longer allows.
 *
 * Now the change moves every seeded balance by the same amount, so what a team has already spent stays spent:
 * $100 → $200 turns a team holding $63 into $163. A balance never goes below $0. Unseeded (NULL) balances are left
 * for `seedNullFaabBalances`, which gives them the new budget.
 *
 * ⚠ IMPORTED LEAGUES ARE LEFT ALONE: their balances come from the host platform on every sync, so a rebase here would
 * be overwritten. ⚠ SURVIVOR GUILLOTINE is left alone too: its rules write sets every balance from its own budget.
 */
import { prisma } from '@/lib/prisma'
import { copyGenericFaabToRedraft } from '@/lib/league/faabMirror'

/** The balance a team holds after the budget moves from `oldBudget` to `newBudget`. Pure. */
export function rebasedFaabBalance(current: number | null, oldBudget: number | null, newBudget: number | null): number | null {
  if (current == null || oldBudget == null || newBudget == null) return current
  return Math.max(0, current + (newBudget - oldBudget))
}

/**
 * Move every seeded balance in the league by `newBudget - oldBudget`. Atomic per row (an increment, then a clamp at
 * $0), so a waiver run awarding a bid at the same moment cannot be overwritten. Returns how many teams moved.
 */
export async function rebaseFaabBalancesForBudgetChange(
  leagueId: string,
  oldBudget: number | null,
  newBudget: number | null,
): Promise<{ rebased: number; delta: number }> {
  if (oldBudget == null || newBudget == null || !Number.isFinite(oldBudget) || !Number.isFinite(newBudget)) return { rebased: 0, delta: 0 }
  const delta = Math.round(newBudget - oldBudget)
  if (delta === 0) return { rebased: 0, delta: 0 }
  const seeded = await prisma.roster.findMany({ where: { leagueId, faabRemaining: { not: null } }, select: { id: true } })
  if (seeded.length === 0) return { rebased: 0, delta }
  const ids = seeded.map((r) => r.id)
  await prisma.$transaction([
    prisma.roster.updateMany({ where: { id: { in: ids } }, data: { faabRemaining: { increment: delta } } }),
    prisma.roster.updateMany({ where: { id: { in: ids }, faabRemaining: { lt: 0 } }, data: { faabRemaining: 0 } }),
  ])
  // The redraft season's balance mirrors the generic roster (lib/league/faabMirror.ts).
  await copyGenericFaabToRedraft(prisma as never, ids)
  return { rebased: ids.length, delta }
}

/** Native leagues only, and not survivor guillotine (see the header). Pure. */
export function faabBudgetRebaseApplies(league: { platform?: string | null; platformLeagueId?: string | null; leagueVariant?: string | null }): boolean {
  if (league.leagueVariant === 'survivor_guillotine') return false
  const platform = String(league.platform ?? '').trim().toLowerCase()
  return !platform || platform === 'allfantasy' || platform === 'manual' || platform === 'native' || !league.platformLeagueId
}
