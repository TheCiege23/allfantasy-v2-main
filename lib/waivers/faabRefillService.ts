/**
 * FAAB refills (AF Commissioner waiver extra, lib/waivers/waiverExtras.ts): the commissioner sets extra
 * FAAB that every team receives at a given week ("+$25 at the trade deadline"). Applied by the daily
 * Commissioner Workspace refresh once the league reaches that week, exactly once per refill week.
 *
 * Idempotent: the weeks already paid are recorded in `League.settings.af_faab_refills_applied`, read and
 * written inside one transaction with the balances, so two overlapping runs cannot pay twice.
 */
import { prisma } from '@/lib/prisma'
import { leagueWeekFromSettings } from '@/lib/core-app/seasonTimeline'
import { dueFaabRefills, readWaiverExtras } from './waiverExtras'

export const FAAB_REFILLS_APPLIED_KEY = 'af_faab_refills_applied' as const

function appliedWeeks(settings: unknown): number[] {
  const raw = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>)[FAAB_REFILLS_APPLIED_KEY] : null
  return Array.isArray(raw) ? raw.map(Number).filter((n) => Number.isInteger(n)) : []
}

/** Pays every due refill. Returns the dollars added per team (0 when nothing was due). */
export async function applyDueFaabRefills(leagueId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    // Row lock: a concurrent run waits here, then reads the weeks this one recorded.
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!league) return 0
    const extras = readWaiverExtras(league.settings)
    const week = leagueWeekFromSettings(league.settings)
    if (!week || extras.faabRefills.length === 0) return 0
    const applied = appliedWeeks(league.settings)
    const due = dueFaabRefills(extras, week, applied)
    if (due.length === 0) return 0
    const total = due.reduce((sum, r) => sum + r.amount, 0)

    await tx.roster.updateMany({ where: { leagueId, faabRemaining: { not: null } }, data: { faabRemaining: { increment: total } } })
    const season = await tx.redraftSeason.findFirst({ where: { leagueId }, orderBy: [{ season: 'desc' }, { createdAt: 'desc' }], select: { id: true } })
    if (season) {
      await tx.redraftRoster.updateMany({ where: { leagueId, seasonId: season.id }, data: { faabBalance: { increment: total } } })
    }
    const settings = (league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? league.settings : {}) as Record<string, unknown>
    await tx.league.update({
      where: { id: leagueId },
      data: { settings: { ...settings, [FAAB_REFILLS_APPLIED_KEY]: [...applied, ...due.map((r) => r.week)] } as never },
    })
    return total
  })
}
