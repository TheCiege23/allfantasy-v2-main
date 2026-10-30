import { prisma } from '@/lib/prisma'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'

export type ZombieSettlementSnapshotV1 = {
  version: 1
  capturedAt: string
  owners: Array<{ rosterId: string; userId: string | null }>
  teams: Array<{
    id: string; rosterId: string; status: string
    weekBecameZombie: number | null; killedByRosterId: string | null; revivedAt: string | null
    ambushesRemaining: number; ambushesUsed: number; infectionCount: number
    isWhisperer: boolean; killedAtWeek: number | null; killedByUserId: string | null
    survivorWinStreak: number; zombieAttacksSurvived: number
  }>
  items: Array<{
    id: string; teamStatusId: string; userId: string; itemType: string; itemLabel: string
    isUsed: boolean; isExpired: boolean; activationState: string
    activatesAtWeek: number | null; usedAtWeek: number | null
    usedOnUserId: string | null; usedEffect: string | null
    acquiredAtWeek: number | null; awardKey: string | null
  }>
  whisperer: {
    id: string; ambushesGranted: number; ambushesUsed: number; ambushesRemaining: number
    wasDefeated: boolean; defeatedAtWeek: number | null; defeatedByUserId: string | null
    hordeSizeAtPeak: number; totalInfections: number; totalWinningsStolen: number
  } | null
  coWhisperers: Array<{
    id: string; ambushesGranted: number; ambushesUsed: number; ambushesRemaining: number
    wasDefeated: boolean; defeatedAtWeek: number | null
  }>
  config: {
    infectionLossToWhisperer: boolean; infectionLossToZombie: boolean
    serumAwardHighScore: boolean; serumAwardOnBashMaul: boolean
    autoSerumRevive: boolean; serumReviveCount: number
  } | null
  rules: {
    bashingThreshold: number; maulingThreshold: number; weaponAxeMargin: number
    weaponShieldThreshold: number; weaponAmbushThreshold: number
  }
}

/** Capture the game state immediately before any weekly side effect. Never overwrite on retry. */
export async function captureZombieSettlementSnapshot(
  leagueId: string,
  zombieLeagueId: string,
  sport: string,
): Promise<ZombieSettlementSnapshotV1> {
  const [owners, teams, items, whisperer, coWhisperers, config, rules] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
    prisma.zombieLeagueTeam.findMany({
      where: { leagueId },
      select: {
        id: true, rosterId: true, status: true, weekBecameZombie: true,
        killedByRosterId: true, revivedAt: true, ambushesRemaining: true,
        ambushesUsed: true, infectionCount: true, isWhisperer: true,
        killedAtWeek: true, killedByUserId: true, survivorWinStreak: true,
        zombieAttacksSurvived: true,
      },
    }),
    prisma.zombieTeamItem.findMany({
      where: { zombieLeagueId },
      select: {
        id: true, teamStatusId: true, userId: true, itemType: true, itemLabel: true,
        isUsed: true, isExpired: true, activationState: true, activatesAtWeek: true,
        usedAtWeek: true, usedOnUserId: true, usedEffect: true, acquiredAtWeek: true,
        awardKey: true,
      },
    }),
    prisma.whispererRecord.findUnique({
      where: { zombieLeagueId },
      select: {
        id: true, ambushesGranted: true, ambushesUsed: true, ambushesRemaining: true,
        wasDefeated: true, defeatedAtWeek: true, defeatedByUserId: true,
        hordeSizeAtPeak: true, totalInfections: true, totalWinningsStolen: true,
      },
    }),
    prisma.zombieCoWhisperer.findMany({
      where: { zombieLeagueId },
      select: {
        id: true, ambushesGranted: true, ambushesUsed: true, ambushesRemaining: true,
        wasDefeated: true, defeatedAtWeek: true,
      },
    }),
    prisma.zombieLeagueConfig.findUnique({
      where: { leagueId },
      select: {
        infectionLossToWhisperer: true, infectionLossToZombie: true,
        serumAwardHighScore: true, serumAwardOnBashMaul: true,
        autoSerumRevive: true, serumReviveCount: true,
      },
    }),
    getZombieRulesForSport(sport),
  ])
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    owners: owners.map(owner => ({ rosterId: owner.id, userId: owner.platformUserId })),
    teams: teams.map(team => ({ ...team, revivedAt: team.revivedAt?.toISOString() ?? null })),
    items,
    whisperer,
    coWhisperers,
    config,
    rules: {
      bashingThreshold: rules.bashingThreshold,
      maulingThreshold: rules.maulingThreshold,
      weaponAxeMargin: rules.weaponAxeMargin,
      weaponShieldThreshold: rules.weaponShieldThreshold,
      weaponAmbushThreshold: rules.weaponAmbushThreshold,
    },
  }
}

export function parseZombieSettlementSnapshot(value: unknown): ZombieSettlementSnapshotV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (row.version !== 1 || !Array.isArray(row.owners) || !Array.isArray(row.teams) || !Array.isArray(row.items) ||
      !Array.isArray(row.coWhisperers) || !row.rules || typeof row.rules !== 'object') return null
  if (row.teams.some(team => !team || typeof team.id !== 'string' || typeof team.rosterId !== 'string') ||
      row.items.some(item => !item || typeof item.id !== 'string' || typeof item.teamStatusId !== 'string')) return null
  return value as ZombieSettlementSnapshotV1
}
