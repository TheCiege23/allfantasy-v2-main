/**
 * Survivor Import Engine — converts an imported Sleeper league into Survivor format.
 *
 * Flow:
 * 1. Fetch Sleeper league info + rosters via sleeper-client
 * 2. Create League record (platform: sleeper, leagueVariant: survivor)
 * 3. Create SurvivorLeagueConfig with defaults or wizard overrides
 * 4. Form tribes from imported rosters (random or draft-order split)
 * 5. Create SurvivorPlayer records for each roster (all start as active)
 * 6. Create chat channels (tribe, league, exile)
 * 7. Seed idols from power templates
 * 8. Set game state to pre_merge (draft phase is skipped since rosters exist)
 */

import { prisma } from '@/lib/prisma'
import {
  getLeagueInfo,
  getLeagueRosters,
  type SleeperLeague,
  type SleeperRoster,
} from '@/lib/sleeper-client'

export interface SurvivorImportConfig {
  sleeperLeagueId: string
  userId: string
  tribeCount?: number
  tribeFormation?: 'random' | 'draft_pattern'
  tribeNaming?: 'auto' | 'ai' | 'custom'
  exileEnabled?: boolean
  idolsEnabled?: boolean
  idolCount?: number
}

interface SurvivorImportResult {
  leagueId: string
  playerCount: number
  tribeCount: number
  tribesCreated: string[]
  warnings: string[]
}

const DEFAULT_TRIBE_NAMES = ['Malakal', 'Airai', 'Fang', 'Kota', 'Timbira']

function shuffleArray<T>(arr: T[], seed?: string): T[] {
  const shuffled = [...arr]
  let hash = 0
  for (const ch of (seed ?? String(Date.now()))) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0
  const rng = () => { hash = (hash * 1664525 + 1013904223) | 0; return (hash >>> 0) / 0xffffffff }
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled
}

export async function importSleeperAsSurvivor(
  config: SurvivorImportConfig,
): Promise<SurvivorImportResult> {
  const warnings: string[] = []

  // 1. Fetch Sleeper data
  const sleeperLeague = await getLeagueInfo(config.sleeperLeagueId) as SleeperLeague
  const sleeperRosters = await getLeagueRosters(config.sleeperLeagueId) as SleeperRoster[]

  if (!sleeperLeague) throw new Error('Sleeper league not found')
  if (!sleeperRosters?.length) throw new Error('No rosters found in Sleeper league')

  const playerCount = sleeperRosters.length
  const tribeCount = config.tribeCount ?? (playerCount >= 18 ? 4 : playerCount >= 12 ? 3 : 2)
  const tribeSize = Math.floor(playerCount / tribeCount)

  if (playerCount < 10) {
    warnings.push(`Only ${playerCount} rosters found. Survivor works best with 16-20 players.`)
  }

  // 2. Create League record
  const league = await (prisma as any).league.create({
    data: {
      userId: config.userId,
      platform: 'sleeper',
      platformLeagueId: config.sleeperLeagueId,
      name: sleeperLeague.name ?? `Survivor League`,
      sport: (sleeperLeague.sport?.toUpperCase() ?? 'NFL') as any,
      season: sleeperLeague.season ? Number(sleeperLeague.season) : new Date().getFullYear(),
      leagueSize: playerCount,
      scoring: sleeperLeague.scoring_settings ? JSON.stringify(sleeperLeague.scoring_settings) : null,
      leagueType: 'survivor',
      leagueVariant: 'survivor',
      survivorMode: true,
      survivorPlayerCount: playerCount,
      survivorTribeCount: tribeCount,
      survivorTribeSize: tribeSize,
      survivorTribeNaming: config.tribeNaming ?? 'auto',
      survivorExileEnabled: config.exileEnabled ?? true,
      survivorIdolsEnabled: config.idolsEnabled ?? true,
      survivorIdolCount: config.idolCount ?? 9,
      survivorMergeTrigger: 'player_count',
      survivorMergeAtCount: Math.max(6, Math.ceil(playerCount / 2)),
      survivorRocksEnabled: true,
      survivorTieRule: 'rocks',
      survivorRevealMode: 'dramatic',
      survivorTokenEnabled: true,
      survivorBossResetEnabled: true,
      settings: sleeperLeague.settings ?? {},
    },
  })

  // 3. Create Roster records from Sleeper data
  for (const sr of sleeperRosters) {
    await (prisma as any).roster.upsert({
      where: {
        leagueId_platformUserId: {
          leagueId: league.id,
          platformUserId: String(sr.owner_id ?? sr.roster_id),
        },
      },
      create: {
        leagueId: league.id,
        platformUserId: String(sr.owner_id ?? sr.roster_id),
        playerData: sr.players ?? [],
        settings: sr.settings ?? {},
      },
      update: {
        playerData: sr.players ?? [],
      },
    })
  }

  // 4. Create SurvivorLeagueConfig
  await (prisma as any).survivorLeagueConfig.upsert({
    where: { leagueId: league.id },
    create: {
      leagueId: league.id,
      mode: 'redraft',
      tribeCount,
      tribeSize,
      tribeFormation: config.tribeFormation ?? 'random',
      mergeTrigger: 'player_count',
      mergePlayerCount: Math.max(6, Math.ceil(playerCount / 2)),
      idolCount: config.idolsEnabled !== false ? (config.idolCount ?? 9) : 0,
      exileReturnEnabled: config.exileEnabled ?? true,
      selfVoteDisallowed: true,
    },
    update: {},
  })

  // 5. Form tribes
  const rosters = await (prisma as any).roster.findMany({
    where: { leagueId: league.id },
    select: { id: true, platformUserId: true },
  })

  const rosterIds = config.tribeFormation === 'draft_pattern'
    ? rosters.map((r: any) => r.id)
    : shuffleArray(rosters.map((r: any) => r.id), league.id)

  const tribesCreated: string[] = []
  for (let t = 0; t < tribeCount; t++) {
    const tribeName = DEFAULT_TRIBE_NAMES[t] ?? `Tribe ${t + 1}`
    const tribe = await (prisma as any).survivorTribe.create({
      data: {
        leagueId: league.id,
        configId: (await (prisma as any).survivorLeagueConfig.findUnique({ where: { leagueId: league.id } }))?.id,
        name: tribeName,
        slotIndex: t,
        isActive: true,
        phase: 'pre_merge',
      },
    })
    tribesCreated.push(tribe.id)

    // Assign rosters to tribe
    const tribeRosters = rosterIds.slice(t * tribeSize, (t + 1) * tribeSize)
    for (const rosterId of tribeRosters) {
      await (prisma as any).survivorTribeMember.create({
        data: { tribeId: tribe.id, rosterId },
      })
    }

    // Create tribe chat channel
    await (prisma as any).survivorChatChannel.create({
      data: {
        leagueId: league.id,
        name: `${tribeName} Chat`,
        channelType: 'tribe',
        tribeId: tribe.id,
        memberUserIds: [],
      },
    })
  }

  // Handle remainder rosters (if playerCount not evenly divisible)
  const assignedCount = tribeCount * tribeSize
  if (assignedCount < rosterIds.length) {
    const remainder = rosterIds.slice(assignedCount)
    for (let i = 0; i < remainder.length; i++) {
      const tribeId = tribesCreated[i % tribesCreated.length]!
      await (prisma as any).survivorTribeMember.create({
        data: { tribeId, rosterId: remainder[i] },
      })
    }
    warnings.push(`${remainder.length} extra roster(s) distributed across tribes`)
  }

  // 6. Create SurvivorPlayer records
  for (const roster of rosters) {
    await (prisma as any).survivorPlayer.create({
      data: {
        leagueId: league.id,
        userId: roster.platformUserId,
        displayName: roster.platformUserId,
        playerState: 'active',
        tokenBalance: 0,
        totalTokensEarned: 0,
        hasImmunityThisWeek: false,
        canAccessTribeChat: true,
        canAccessMergeChat: false,
        canAccessExileChat: false,
        canAccessJuryChat: false,
        canAccessFinaleChat: false,
        isJuryMember: false,
        isFinalist: false,
      },
    })
  }

  // 7. Create league-level chat channel
  await (prisma as any).survivorChatChannel.create({
    data: {
      leagueId: league.id,
      name: 'Island Chat',
      channelType: 'league',
      memberUserIds: [],
    },
  })

  // 8. Create game state (skip draft, start at pre_merge)
  await (prisma as any).survivorGameState.create({
    data: {
      leagueId: league.id,
      phase: 'pre_merge',
      currentWeek: 1,
      activeTribeCount: tribeCount,
      activePlayerCount: playerCount,
      exilePlayerCount: 0,
      juryPlayerCount: 0,
      draftCompletedAt: new Date(),
      preMergeStartedAt: new Date(),
    },
  })

  return {
    leagueId: league.id,
    playerCount,
    tribeCount,
    tribesCreated,
    warnings,
  }
}
