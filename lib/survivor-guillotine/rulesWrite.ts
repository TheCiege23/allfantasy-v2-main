import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { SGConfig } from './types'

/**
 * Writes Survivor Guilly rules onto a league inside the caller's transaction: the season row, the
 * `survivor_guillotine` variant, and the FAAB budget on every waiver surface.
 *
 * Two callers, one write. `saveSGLiveLeague` runs its eligibility checks first and calls this in its
 * own serializable transaction; league creation calls it in the SAME transaction that created the
 * league, so a new Survivor Guilly league can never commit as a plain redraft shell without rules.
 * Callers must have validated `config` with `buildSGSchedule` already.
 */
export async function writeSGRulesInTransaction(tx: Prisma.TransactionClient, leagueId: string, config: SGConfig) {
  const currentLeague = await tx.league.findUniqueOrThrow({ where: { id: leagueId }, select: { settings: true } })
  const settings = currentLeague.settings && typeof currentLeague.settings === 'object' && !Array.isArray(currentLeague.settings)
    ? currentLeague.settings as Record<string, unknown> : {}
  const result = await tx.survivorGuillotineLeague.upsert({ where: { leagueId },
    create: { id: randomUUID(), leagueId, config: config as unknown as Prisma.InputJsonValue },
    update: { config: config as unknown as Prisma.InputJsonValue, revision: { increment: 1 } },
    select: { leagueId: true, status: true, revision: true } })
  await tx.league.update({ where: { id: leagueId }, data: { leagueVariant: 'survivor_guillotine', waiverType: 'faab', waiverBudget: config.faabBudget,
    settings: { ...settings, survivorGuillotine: { tradesEnabled: config.tradesEnabled } } as Prisma.InputJsonValue } })
  await tx.leagueWaiverSettings.upsert({ where: { leagueId },
    create: { leagueId, waiverType: 'faab', faabBudget: config.faabBudget, instantFaAfterClear: false },
    update: { waiverType: 'faab', faabBudget: config.faabBudget, instantFaAfterClear: false } })
  await tx.roster.updateMany({ where: { leagueId }, data: { faabRemaining: config.faabBudget } })
  await tx.redraftRoster.updateMany({ where: { leagueId }, data: { faabBalance: config.faabBudget } })
  return result
}
