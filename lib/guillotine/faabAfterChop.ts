import { prisma } from '@/lib/prisma'
import { faabAfterChop, readAdvanced } from './chopSchedule'

/**
 * Apply the league's "FAAB after a chop" rule (./chopSchedule, spec §4.5 released-player rules) once
 * a week's chop is recorded: every surviving team keeps, tops up, or resets its FAAB.
 *
 * ⚠ ONCE PER CHOPPED WEEK, NOT ONCE PER CALL. A chop is retried (stat-correction reruns, audit
 * recovery), and a top-up applied twice hands every survivor double money. The marker is a
 * `faab_after_chop` event keyed on the season and week, written in the same transaction as the
 * balances under the league row lock, so a retry finds it and does nothing.
 *
 * Survivors are counted the way the week evaluator counts them: every roster in the league without a
 * chop record. Balances live on `Roster.faabRemaining`, the column the waiver engine spends.
 */

export type FaabAfterChopResult =
  | { applied: true; rosters: number }
  | { applied: false; reason: 'rule_unchanged' | 'already_applied' | 'no_survivors' }

export async function applyFaabAfterChop(input: { leagueId: string; seasonKey: string; weekOrPeriod: number }): Promise<FaabAfterChopResult> {
  const key = `${input.seasonKey}:${input.weekOrPeriod}`
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${input.leagueId} FOR UPDATE`
    const league = await tx.league.findUnique({ where: { id: input.leagueId }, select: { settings: true } })
    const rule = readAdvanced(league?.settings).faab
    if (rule.mode === 'unchanged') return { applied: false, reason: 'rule_unchanged' } as const
    const done = await tx.guillotineEventLog.findFirst({
      where: { leagueId: input.leagueId, eventType: 'faab_after_chop', metadata: { path: ['key'], equals: key } },
      select: { id: true },
    })
    if (done) return { applied: false, reason: 'already_applied' } as const

    const [rosters, chopped] = await Promise.all([
      tx.roster.findMany({ where: { leagueId: input.leagueId }, select: { id: true, faabRemaining: true } }),
      tx.guillotineRosterState.findMany({ where: { leagueId: input.leagueId, choppedAt: { not: null } }, select: { rosterId: true } }),
    ])
    const out = new Set(chopped.map((c) => c.rosterId))
    const survivors = rosters.filter((r) => !out.has(r.id))
    if (survivors.length === 0) return { applied: false, reason: 'no_survivors' } as const

    const changes = survivors.map((r) => ({ rosterId: r.id, before: r.faabRemaining, after: faabAfterChop(rule, r.faabRemaining) }))
    for (const c of changes) {
      if (c.after !== c.before) await tx.roster.update({ where: { id: c.rosterId }, data: { faabRemaining: c.after } })
    }
    await tx.guillotineEventLog.create({
      data: { leagueId: input.leagueId, eventType: 'faab_after_chop', metadata: { key, weekOrPeriod: input.weekOrPeriod, rule, changes } },
    })
    return { applied: true, rosters: changes.length } as const
  })
}
