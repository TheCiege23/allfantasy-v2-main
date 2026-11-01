import type { Prisma } from '@prisma/client'
import { readBetaItemMatchup } from './beta2025ItemSettlement'
import type { ItemWeekMatchup } from './beta2025Items'
import { loadNativeWeekResults } from './ZombieInfectionEngine'
import { beta2025ContextFromSnapshot, computeBeta2025Winnings } from './beta2025Winnings'
import { prisma } from '@/lib/prisma'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'

export type ZombieSettlementSnapshotV1 = {
  version: 1
  itemsPolicy?: 'beta_2025'
  itemMatchups?: ItemWeekMatchup[]
  itemWeaponsEnabled?: boolean
  capturedAt: string
  winnings?: { policy: 'beta_2025'; openingByRoster: Record<string, number> }
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
  week: number,
  season: number,
  db: Prisma.TransactionClient = prisma,
): Promise<ZombieSettlementSnapshotV1> {
  const priorWinnings = await db.zombieWeeklyWinnings.findMany({
    where: { leagueId, week: { lt: week } }, select: { rosterId: true, amount: true, source: true },
  })
  if (priorWinnings.some(row => row.source !== 'weekly_settlement_2025')) {
    throw new Error('ZOMBIE_WINNINGS_POLICY_REVIEW_REQUIRED')
  }
  const [owners, teams, items, whisperer, coWhisperers, config, rules] = await Promise.all([
    db.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
    db.zombieLeagueTeam.findMany({
      where: { leagueId },
      select: {
        id: true, rosterId: true, status: true, weekBecameZombie: true,
        killedByRosterId: true, revivedAt: true, ambushesRemaining: true,
        ambushesUsed: true, infectionCount: true, isWhisperer: true,
        killedAtWeek: true, killedByUserId: true, survivorWinStreak: true,
        zombieAttacksSurvived: true,
      },
    }),
    db.zombieTeamItem.findMany({
      where: { zombieLeagueId },
      select: {
        id: true, teamStatusId: true, userId: true, itemType: true, itemLabel: true,
        isUsed: true, isExpired: true, activationState: true, activatesAtWeek: true,
        usedAtWeek: true, usedOnUserId: true, usedEffect: true, acquiredAtWeek: true,
        awardKey: true,
      },
    }),
    db.whispererRecord.findUnique({
      where: { zombieLeagueId },
      select: {
        id: true, ambushesGranted: true, ambushesUsed: true, ambushesRemaining: true,
        wasDefeated: true, defeatedAtWeek: true, defeatedByUserId: true,
        hordeSizeAtPeak: true, totalInfections: true, totalWinningsStolen: true,
      },
    }),
    db.zombieCoWhisperer.findMany({
      where: { zombieLeagueId },
      select: {
        id: true, ambushesGranted: true, ambushesUsed: true, ambushesRemaining: true,
        wasDefeated: true, defeatedAtWeek: true,
      },
    }),
    db.zombieLeagueConfig.findUnique({
      where: { leagueId },
      select: {
        infectionLossToWhisperer: true, infectionLossToZombie: true,
        serumAwardHighScore: true, serumAwardOnBashMaul: true,
        autoSerumRevive: true, serumReviveCount: true,
      },
    }),
    getZombieRulesForSport(sport),
  ])
  const openingByRoster = Object.fromEntries(teams.map(team => [team.rosterId, 0]))
  for (const row of priorWinnings) openingByRoster[row.rosterId] = Math.round(((openingByRoster[row.rosterId] ?? 0) + row.amount) * 100) / 100
  if (Object.values(openingByRoster).some(n => !Number.isFinite(n) || n < 0)) throw new Error('ZOMBIE_WINNINGS_INVALID_BALANCE')
  const snapshot: ZombieSettlementSnapshotV1 = {
    version: 1,
    winnings: { policy: 'beta_2025', openingByRoster },
    capturedAt: new Date().toISOString(),
    owners: owners.map(owner => ({ rosterId: owner.id, userId: owner.platformUserId })),
    teams: teams.map(team => ({ ...team, revivedAt: team.revivedAt?.toISOString() ?? null })),
    items,
    whisperer,
    coWhisperers,
    config: config && sport.toUpperCase() === 'NFL' ? { ...config, serumAwardHighScore: true, serumAwardOnBashMaul: true, autoSerumRevive: true, serumReviveCount: 2 } : config,
    rules: {
      bashingThreshold: sport.toUpperCase() === 'NFL' ? 60 : rules.bashingThreshold,
      maulingThreshold: sport.toUpperCase() === 'NFL' ? 60 : rules.maulingThreshold,
      weaponAxeMargin: rules.weaponAxeMargin,
      weaponShieldThreshold: rules.weaponShieldThreshold,
      weaponAmbushThreshold: rules.weaponAmbushThreshold,
    },
  }
  const results = await loadNativeWeekResults(leagueId, week, season, db)
  // Validate roles, balances, pairings and thresholds before any infection or item side effect.
  if (results) computeBeta2025Winnings(results, beta2025ContextFromSnapshot(snapshot)!, snapshot.rules)
  if (sport.toUpperCase() === 'NFL') {
    const z = await db.zombieLeague.findUnique({ where: { id: zombieLeagueId } })
    const raw = await db.redraftMatchup.findMany({ where: { leagueId, week }, select: { id: true, lineupSnapshots: true } })
    snapshot.itemsPolicy = 'beta_2025'
    snapshot.itemWeaponsEnabled = z?.experienceMode !== 'simple'
    snapshot.itemMatchups = (results ?? []).flatMap(m => {
      if (!m.final || !m.homeRosterId || !m.awayRosterId) return []
      return [readBetaItemMatchup({ ...m, homeRosterId: m.homeRosterId, awayRosterId: m.awayRosterId, lineupSnapshots: raw.find(r => r.id === m.matchupId)?.lineupSnapshots })]
    })
    if (!snapshot.itemMatchups.length) throw new Error('ZOMBIE_ITEMS_MISSING_SCORE_RECEIPT')
  }
  return snapshot
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
