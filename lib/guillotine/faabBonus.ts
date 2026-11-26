import { prisma } from '@/lib/prisma'
import { copyGenericFaabToRedraft } from '@/lib/league/faabMirror'
import { readAdvanced } from './chopSchedule'
import { splitChoppedFaab } from './faabOnChop'

/**
 * Bonus FAAB for the week's top scorer (owner's list, 2026-11-25), once a week's chop is recorded: the surviving
 * team with the week's highest score gets `topScorerBonus` more FAAB (./chopSchedule.ts). A tie at the top splits
 * it in whole dollars, the leftover going to the lowest balances (the split's own rule, ./faabOnChop.ts).
 *
 * The same shape as the other after-chop FAAB step (./faabAfterChop.ts), on purpose:
 *   - ONCE PER CHOPPED WEEK: a `faab_bonus` event keyed on the season and week, written in the same transaction as
 *     the balances under the league row lock, so a retried chop finds it and pays nothing more;
 *   - RUN AFTER the survivors' reset, so a "resets to $X" rule cannot wipe the bonus out;
 *   - UNDONE by chop undo, from the before/after it records (./chopUndoService.ts), first, since it ran last.
 *
 * The week's scores are the ones the chop saved (`GuillotinePeriodScore`), which is what a retry or a recovery
 * reads too, so the winner cannot change between runs. A no-chop week has no chop to follow, so no bonus.
 */

export type FaabBonusResult =
  | { applied: true; winners: string[]; amount: number }
  | { applied: false; reason: 'off' | 'already_applied' | 'no_scores' }

/** Pure: the top scorer(s) among the survivors, and what each gets. */
export function topScorerBonus(
  amount: number,
  survivors: ReadonlyArray<{ rosterId: string; points: number; faab: number }>,
): Map<string, number> {
  const scored = survivors.filter((s) => Number.isFinite(s.points))
  if (amount <= 0 || scored.length === 0) return new Map()
  const top = Math.max(...scored.map((s) => s.points))
  const winners = scored.filter((s) => s.points === top).map((s) => ({ rosterId: s.rosterId, faab: s.faab }))
  return splitChoppedFaab(amount, winners).shares
}

export async function applyTopScorerBonus(input: { leagueId: string; seasonKey: string; season: number | null | undefined; weekOrPeriod: number }): Promise<FaabBonusResult> {
  const key = `${input.seasonKey}:${input.weekOrPeriod}`
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${input.leagueId} FOR UPDATE`
    const league = await tx.league.findUnique({ where: { id: input.leagueId }, select: { settings: true } })
    const amount = readAdvanced(league?.settings).topScorerBonus ?? 0
    if (amount <= 0) return { applied: false, reason: 'off' } as const
    const done = await tx.guillotineEventLog.findFirst({
      where: { leagueId: input.leagueId, eventType: 'faab_bonus', metadata: { path: ['key'], equals: key } },
      select: { id: true },
    })
    if (done) return { applied: false, reason: 'already_applied' } as const

    const [scores, rosters, chopped] = await Promise.all([
      tx.guillotinePeriodScore.findMany({
        where: { leagueId: input.leagueId, weekOrPeriod: input.weekOrPeriod, ...(input.season != null ? { season: input.season } : {}) },
        select: { rosterId: true, periodPoints: true },
      }),
      tx.roster.findMany({ where: { leagueId: input.leagueId }, select: { id: true, faabRemaining: true } }),
      tx.guillotineRosterState.findMany({ where: { leagueId: input.leagueId, choppedAt: { not: null } }, select: { rosterId: true } }),
    ])
    const out = new Set(chopped.map((c) => c.rosterId))
    const points = new Map(scores.map((s) => [s.rosterId, Number(s.periodPoints)]))
    const survivors = rosters
      .filter((r) => !out.has(r.id) && points.has(r.id))
      .map((r) => ({ rosterId: r.id, points: points.get(r.id)!, faab: r.faabRemaining ?? 0 }))
    const shares = topScorerBonus(amount, survivors)
    if (shares.size === 0) return { applied: false, reason: 'no_scores' } as const

    const before = new Map(rosters.map((r) => [r.id, r.faabRemaining]))
    const changes = [...shares].map(([rosterId, share]) => ({ rosterId, before: before.get(rosterId) ?? null, after: (before.get(rosterId) ?? 0) + share }))
    for (const c of changes) await tx.roster.update({ where: { id: c.rosterId }, data: { faabRemaining: c.after } })
    await copyGenericFaabToRedraft(tx, changes.map((c) => c.rosterId))
    await tx.guillotineEventLog.create({
      data: { leagueId: input.leagueId, eventType: 'faab_bonus', metadata: { key, weekOrPeriod: input.weekOrPeriod, amount, changes } },
    })
    return { applied: true, winners: changes.map((c) => c.rosterId), amount } as const
  })
}
