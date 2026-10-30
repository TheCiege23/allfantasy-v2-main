/**
 * Load and validate Zombie league config from DB (PROMPT 353).
 * NFL-first; sport-extensible.
 */

import { prisma } from '@/lib/prisma'
import type { ZombieLeagueConfigLoaded, WhispererSelection, WeaponThreshold } from './types'

const ZOMBIE_VARIANT = 'zombie'

function toWhispererSelection(s: unknown): WhispererSelection {
  if (s === 'veteran_priority') return 'veteran_priority'
  return 'random'
}

function parseWeaponThresholds(raw: unknown): WeaponThreshold[] | null {
  if (!Array.isArray(raw)) return null
  const out: WeaponThreshold[] = []
  for (const item of raw) {
    if (item && typeof item === 'object' && typeof (item as { minPoints?: number }).minPoints === 'number') {
      out.push({
        minPoints: (item as { minPoints: number }).minPoints,
        weaponType: typeof (item as { weaponType?: string }).weaponType === 'string' ? (item as { weaponType: string }).weaponType : 'base',
      })
    }
  }
  return out.length ? out : null
}

export async function isZombieLeague(leagueId: string): Promise<boolean> {
  const config = await prisma.zombieLeagueConfig.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  if (config) return true
  // Native Zombie creation can attach the ZombieLeague row before a separate config is upserted.
  const nativeLeague = await prisma.zombieLeague.findUnique({
    where: { leagueId },
    select: { id: true },
  })
  if (nativeLeague) return true
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { leagueVariant: true },
  })
  return league?.leagueVariant === ZOMBIE_VARIANT
}

export async function getZombieLeagueConfig(leagueId: string): Promise<ZombieLeagueConfigLoaded | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, leagueVariant: true },
  })
  if (!league) return null

  const row = await prisma.zombieLeagueConfig.findUnique({
    where: { leagueId },
  })
  if (row) {
    return {
      leagueId: row.leagueId,
      configId: row.id,
      universeId: row.universeId,
      whispererSelection: toWhispererSelection(row.whispererSelection),
      infectionLossToWhisperer: row.infectionLossToWhisperer,
      infectionLossToZombie: row.infectionLossToZombie,
      serumReviveCount: row.serumReviveCount,
      autoSerumRevive: row.autoSerumRevive,
      serumAwardHighScore: row.serumAwardHighScore,
      serumAwardOnBashMaul: row.serumAwardOnBashMaul,
      serumUseBeforeLastStarter: row.serumUseBeforeLastStarter,
      weaponScoreThresholds: parseWeaponThresholds(row.weaponScoreThresholds),
      weaponTopTwoActive: row.weaponTopTwoActive,
      bombOneTimeOverride: row.bombOneTimeOverride,
      ambushCountPerWeek: row.ambushCountPerWeek,
      ambushRemapMatchup: row.ambushRemapMatchup,
      noWaiverFreeAgency: row.noWaiverFreeAgency,
      statCorrectionReversal: row.statCorrectionReversal,
      zombieTradeBlocked: row.zombieTradeBlocked,
      dangerousDropThreshold: row.dangerousDropThreshold,
    }
  }

  if (league.leagueVariant !== ZOMBIE_VARIANT && !(await prisma.zombieLeague.findUnique({ where: { leagueId }, select: { id: true } }))) return null

  return {
    leagueId: league.id,
    configId: '',
    universeId: null,
    whispererSelection: 'random',
    infectionLossToWhisperer: true,
    infectionLossToZombie: true,
    serumReviveCount: 2,
    autoSerumRevive: false,
    serumAwardHighScore: true,
    serumAwardOnBashMaul: true,
    serumUseBeforeLastStarter: true,
    weaponScoreThresholds: null,
    weaponTopTwoActive: true,
    bombOneTimeOverride: false,
    ambushCountPerWeek: 1,
    ambushRemapMatchup: true,
    noWaiverFreeAgency: true,
    statCorrectionReversal: false,
    zombieTradeBlocked: true,
    dangerousDropThreshold: null,
  }
}

export async function upsertZombieLeagueConfig(
  leagueId: string,
  input: Partial<{
    universeId: string | null
    whispererSelection: string
    infectionLossToWhisperer: boolean
    infectionLossToZombie: boolean
    serumReviveCount: number
    autoSerumRevive: boolean
    serumAwardHighScore: boolean
    serumAwardOnBashMaul: boolean
    serumUseBeforeLastStarter: boolean
    weaponScoreThresholds: WeaponThreshold[] | object
    weaponTopTwoActive: boolean
    bombOneTimeOverride: boolean
    ambushCountPerWeek: number
    ambushRemapMatchup: boolean
    noWaiverFreeAgency: boolean
    statCorrectionReversal: boolean
    zombieTradeBlocked: boolean
    dangerousDropThreshold: number | null
  }>
): Promise<ZombieLeagueConfigLoaded | null> {
  await prisma.zombieLeagueConfig.upsert({
    where: { leagueId },
    create: {
      leagueId,
      universeId: input.universeId ?? null,
      whispererSelection: input.whispererSelection ?? 'random',
      infectionLossToWhisperer: input.infectionLossToWhisperer ?? true,
      infectionLossToZombie: input.infectionLossToZombie ?? true,
      serumReviveCount: input.serumReviveCount ?? 2,
      autoSerumRevive: input.autoSerumRevive ?? false,
      serumAwardHighScore: input.serumAwardHighScore ?? true,
      serumAwardOnBashMaul: input.serumAwardOnBashMaul ?? true,
      serumUseBeforeLastStarter: input.serumUseBeforeLastStarter ?? true,
      weaponScoreThresholds: (Array.isArray(input.weaponScoreThresholds) ? input.weaponScoreThresholds : undefined) as object | undefined,
      weaponTopTwoActive: input.weaponTopTwoActive ?? true,
      bombOneTimeOverride: input.bombOneTimeOverride ?? false,
      ambushCountPerWeek: input.ambushCountPerWeek ?? 1,
      ambushRemapMatchup: input.ambushRemapMatchup ?? true,
      noWaiverFreeAgency: input.noWaiverFreeAgency ?? true,
      statCorrectionReversal: input.statCorrectionReversal ?? false,
      zombieTradeBlocked: input.zombieTradeBlocked ?? true,
      dangerousDropThreshold: input.dangerousDropThreshold ?? null,
    },
    update: {
      ...(input.universeId !== undefined && { universeId: input.universeId }),
      ...(input.whispererSelection !== undefined && { whispererSelection: input.whispererSelection }),
      ...(input.infectionLossToWhisperer !== undefined && { infectionLossToWhisperer: input.infectionLossToWhisperer }),
      ...(input.infectionLossToZombie !== undefined && { infectionLossToZombie: input.infectionLossToZombie }),
      ...(input.serumReviveCount !== undefined && { serumReviveCount: input.serumReviveCount }),
      ...(input.autoSerumRevive !== undefined && { autoSerumRevive: input.autoSerumRevive }),
      ...(input.serumAwardHighScore !== undefined && { serumAwardHighScore: input.serumAwardHighScore }),
      ...(input.serumAwardOnBashMaul !== undefined && { serumAwardOnBashMaul: input.serumAwardOnBashMaul }),
      ...(input.serumUseBeforeLastStarter !== undefined && { serumUseBeforeLastStarter: input.serumUseBeforeLastStarter }),
      ...(input.weaponScoreThresholds !== undefined && { weaponScoreThresholds: input.weaponScoreThresholds as object }),
      ...(input.weaponTopTwoActive !== undefined && { weaponTopTwoActive: input.weaponTopTwoActive }),
      ...(input.bombOneTimeOverride !== undefined && { bombOneTimeOverride: input.bombOneTimeOverride }),
      ...(input.ambushCountPerWeek !== undefined && { ambushCountPerWeek: input.ambushCountPerWeek }),
      ...(input.ambushRemapMatchup !== undefined && { ambushRemapMatchup: input.ambushRemapMatchup }),
      ...(input.noWaiverFreeAgency !== undefined && { noWaiverFreeAgency: input.noWaiverFreeAgency }),
      ...(input.statCorrectionReversal !== undefined && { statCorrectionReversal: input.statCorrectionReversal }),
      ...(input.zombieTradeBlocked !== undefined && { zombieTradeBlocked: input.zombieTradeBlocked }),
      ...(input.dangerousDropThreshold !== undefined && { dangerousDropThreshold: input.dangerousDropThreshold }),
    },
  })
  return getZombieLeagueConfig(leagueId)
}
