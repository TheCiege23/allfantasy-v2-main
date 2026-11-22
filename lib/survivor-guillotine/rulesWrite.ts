import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { SGConfig } from './types'
import { applySGRosterExpansion } from './rosterExpansionService'

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
    settings: { ...settings, lineup_history_version: 1, hasPlayoffs: false, playoffStartWeek: config.championshipPeriod + 1,
      survivorGuillotine: { ...((settings.survivorGuillotine ?? {}) as Record<string, unknown>), tradesEnabled: config.tradesEnabled } } as Prisma.InputJsonValue } })
  await tx.leagueWaiverSettings.upsert({ where: { leagueId },
    create: { leagueId, waiverType: 'faab', faabBudget: config.faabBudget, instantFaAfterClear: false },
    update: { waiverType: 'faab', faabBudget: config.faabBudget, instantFaAfterClear: false } })
  await tx.roster.updateMany({ where: { leagueId }, data: { faabRemaining: config.faabBudget } })
  await tx.redraftRoster.updateMany({ where: { leagueId }, data: { faabBalance: config.faabBudget } })
  // The first epoch is a present-time baseline, never evidence about past games.
  await tx.$executeRaw`WITH inserted AS (
    INSERT INTO redraft_lineup_history_epochs ("leagueId", "legacyBaseline")
    VALUES (${leagueId}, EXISTS (SELECT 1 FROM redraft_rosters r JOIN redraft_roster_players p ON p."rosterId" = r.id WHERE r."leagueId" = ${leagueId} AND p."droppedAt" IS NULL))
    ON CONFLICT ("leagueId") DO NOTHING RETURNING "leagueId", "coveredFrom"
  ) INSERT INTO redraft_player_state_events ("leagueId", "seasonId", "sourcePlayerRowId", "effectiveAt", "afterState")
    SELECT r."leagueId", r."seasonId", p.id, i."coveredFrom", to_jsonb(p)
    FROM inserted i JOIN redraft_rosters r ON r."leagueId" = i."leagueId"
    JOIN redraft_roster_players p ON p."rosterId" = r.id WHERE p."droppedAt" IS NULL`
  await applySGRosterExpansion(tx, leagueId, config, 0)
  return result
}
