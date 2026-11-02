import type { Prisma } from '@prisma/client'
import type { ValidatedCreateLeagueBody } from './validateCreateLeague'
import type { PresetEngineOutput } from './types'
import { createCanonicalLeagueInTransaction } from './createCanonicalLeagueInTransaction'
import { createZombieLeague } from '@/lib/zombie/setupEngine'
import { zombieCreationLeagueCount } from '@/lib/zombie/creationPolicy'
import { getZombieUniverseLevelPlanForCount } from '@/lib/zombie/zombie-universe-tier'

export type CreatedZombieUniverse = {
  universeId: string
  leagues: Array<{ leagueId: string; homepageUrl: string; body: ValidatedCreateLeagueBody }>
}

/** All league shells, ownership, invitations, tiers and Zombie links commit together. */
export async function createZombieUniverseInTransaction(
  tx: Prisma.TransactionClient,
  commissionerId: string,
  body: ValidatedCreateLeagueBody,
  engine: PresetEngineOutput,
): Promise<CreatedZombieUniverse> {
  const count = zombieCreationLeagueCount(body.conceptSetup)
  const plan = getZombieUniverseLevelPlanForCount(count)
  const universe = await tx.zombieUniverse.create({ data: {
    name: body.leagueName.slice(0, 128), sport: String(body.sport), status: 'setup',
    commissionedByUserId: commissionerId, createdByUserId: commissionerId,
    tiersEnabled: plan.length > 1, tierCount: plan.length,
    // Keep an auditable seed; generated universe/level identifiers are added only to child settings.
    settings: { creationTemplate: body, leagueCount: count } as unknown as Prisma.InputJsonValue,
  } })
  const leagues: Array<{ leagueId: string; homepageUrl: string; body: ValidatedCreateLeagueBody }> = []
  for (const levelPlan of plan) {
    const level = await tx.zombieUniverseLevel.create({ data: {
      universeId: universe.id, name: levelPlan.name, rankOrder: levelPlan.rankOrder,
      tierLabel: levelPlan.tierLabel, tierLevel: 4 - levelPlan.rankOrder,
      leagueCount: levelPlan.leagueSlots, maxLeagues: Math.max(4, levelPlan.leagueSlots), teamsPerLeague: body.teamCount,
    } })
    for (let index = 0; index < levelPlan.leagueSlots; index++) {
      const suffix = ` · ${levelPlan.name} ${index + 1}`
      const child: ValidatedCreateLeagueBody = {
        ...body, leagueName: body.leagueName.slice(0, 100 - suffix.length) + suffix,
        conceptSetup: { ...body.conceptSetup, zombie_universe_id: universe.id, zombie_level_id: level.id },
      }
      const childEngine: PresetEngineOutput = {
        ...engine, settingsSnapshot: { ...engine.settingsSnapshot, conceptSetup: child.conceptSetup ?? undefined },
      }
      const created = await createCanonicalLeagueInTransaction(tx, commissionerId, child, childEngine)
      const whispererSelection = child.conceptSetup?.zombie_whisperer_selection === 'veteran_priority' ? 'veteran_priority' : 'random'
      const zombie = await createZombieLeague({
        leagueId: created.leagueId, name: child.leagueName, sport: String(body.sport),
        teamCount: body.teamCount, isSingleLeague: false, whispererSelectionMode: whispererSelection,
      }, universe.id, level.id, tx)
      await tx.zombieLeague.update({ where: { id: zombie.id }, data: { orderInLevel: index } })
      await tx.zombieLeagueConfig.update({ where: { leagueId: created.leagueId }, data: { universeId: universe.id, whispererSelection } })
      leagues.push({ leagueId: created.leagueId, homepageUrl: created.homepageUrl, body: child })
    }
  }
  return { universeId: universe.id, leagues }
}
