import { getZombieCreationTeamCounts, ZOMBIE_DEFAULT_MANAGERS } from '@/lib/zombie/creationPolicy'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { generateLeagueName, generateUniverseName } from '@/lib/zombie/namingEngine'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import {
  getZombieUniverseLevelPlan,
  type ZombieUniverseTierId,
} from '@/lib/zombie/zombie-universe-tier'
import { getRandomZombieTheme } from '@/lib/zombie/zombieBackgroundThemes'
import { getZombieSeasonSchedule } from '@/lib/zombie/zombieSeasonSchedule'
import { zombieExperienceDefaults, type ZombieExperienceMode } from '@/lib/zombie/zombieExperience'

export type ZombieUniverseConfig = {
  name?: string
  sport?: string
  tiersEnabled?: boolean
  tierCount?: number
  namingMode?: string
  isPaid?: boolean
  defaultBuyIn?: number | null
  newMembersStartAtBottom?: boolean
  promotionEnabled?: boolean
  relegationEnabled?: boolean
  promotionCount?: number
  relegationCount?: number
  promotionMode?: string
}

export type ZombieLeagueSetupConfig = {
  leagueId: string
  name?: string | null
  sport: string
  season?: number
  teamCount?: number
  isPaid?: boolean
  buyInAmount?: number | null
  whispererSelectionMode?: string
  namingMode?: string
  isSingleLeague?: boolean
  slug?: string
  backgroundTheme?: string | null
  experienceMode?: ZombieExperienceMode
  whispererCount?: 1 | 2
}

/**
 * Create a zombie universe and default Alpha/Beta/Gamma tiers when tiers are enabled.
 */
export async function createZombieUniverse(commissionerId: string, config: ZombieUniverseConfig) {
  const sport = normalizeToSupportedSport(config.sport ?? 'NFL')
  const tierCount = config.tierCount ?? 3
  const namingMode = config.namingMode ?? 'hybrid'
  const baseName =
    config.name?.trim() ||
    generateUniverseName(
      (
        await prisma.zombieUniverse.findMany({ select: { name: true }, take: 500 })
      ).map((u) => u.name),
    )

  const universe = await prisma.zombieUniverse.create({
    data: {
      name: baseName,
      sport,
      status: 'setup',
      tiersEnabled: config.tiersEnabled ?? true,
      tierCount,
      namingMode,
      isPaid: config.isPaid ?? false,
      defaultBuyIn: config.defaultBuyIn ?? null,
      newMembersStartAtBottom: config.newMembersStartAtBottom ?? true,
      promotionEnabled: config.promotionEnabled ?? true,
      relegationEnabled: config.relegationEnabled ?? true,
      promotionCount: config.promotionCount ?? 2,
      relegationCount: config.relegationCount ?? 2,
      promotionMode: config.promotionMode ?? 'auto',
      commissionedByUserId: commissionerId,
      createdByUserId: commissionerId,
    },
  })

  if (universe.tiersEnabled && tierCount >= 1) {
    const labels =
      tierCount === 3
        ? [
            { name: 'Alpha', rank: 3, tierLabel: 'Alpha', tierLevel: 1 },
            { name: 'Beta', rank: 2, tierLabel: 'Beta', tierLevel: 2 },
            { name: 'Gamma', rank: 1, tierLabel: 'Gamma', tierLevel: 3 },
          ]
        : Array.from({ length: tierCount }, (_, i) => ({
            name: `Tier ${tierCount - i}`,
            rank: i + 1,
            tierLabel: `Tier ${tierCount - i}`,
            tierLevel: i + 1,
          }))

    for (const L of labels) {
      await prisma.zombieUniverseLevel.create({
        data: {
          universeId: universe.id,
          name: L.name,
          rankOrder: L.rank,
          tierLabel: L.tierLabel,
          tierLevel: L.tierLevel,
          leagueCount: 1,
        },
      })
    }
  }

  if (namingMode === 'auto' || namingMode === 'hybrid') {
    await prisma.zombieNameRecord.create({
      data: {
        universeId: universe.id,
        entityType: 'universe',
        entityId: universe.id,
        generatedName: baseName,
        finalName: baseName,
        wasEdited: Boolean(config.name?.trim()),
        namingMode,
      },
    })
  }

  return prisma.zombieUniverse.findUniqueOrThrow({
    where: { id: universe.id },
    include: { levels: { orderBy: { rankOrder: 'desc' } } },
  })
}

/**
 * Universe for Zombie create flow: tier-specific level counts (1 / 3 / 6 leagues).
 * Does not create `League` rows — those are created via `/api/league/create` per slot.
 */
export async function createZombieUniverseForTier(
  commissionerId: string,
  config: {
    name?: string
    sport: string
    tier: ZombieUniverseTierId
    namingMode?: string
  },
) {
  const sport = normalizeToSupportedSport(config.sport ?? 'NFL')
  const namingMode = config.namingMode ?? 'hybrid'
  const plan = getZombieUniverseLevelPlan(config.tier)
  const baseName =
    config.name?.trim() ||
    generateUniverseName(
      (await prisma.zombieUniverse.findMany({ select: { name: true }, take: 500 })).map((u) => u.name),
    )

  const universe = await prisma.zombieUniverse.create({
    data: {
      name: baseName,
      sport,
      status: 'setup',
      tiersEnabled: config.tier !== 'single_gamma',
      tierCount: plan.length,
      namingMode,
      isPaid: false,
      defaultBuyIn: null,
      newMembersStartAtBottom: true,
      promotionEnabled: config.tier !== 'single_gamma',
      relegationEnabled: config.tier !== 'single_gamma',
      promotionCount: 2,
      relegationCount: 2,
      promotionMode: 'auto',
      commissionedByUserId: commissionerId,
      createdByUserId: commissionerId,
      settings: {
        zombieUniverseTier: config.tier,
        createdFromWizard: true,
      } as object,
    },
  })

  for (const L of plan) {
    await prisma.zombieUniverseLevel.create({
      data: {
        universeId: universe.id,
        name: L.name,
        rankOrder: L.rankOrder,
        tierLabel: L.tierLabel,
        tierLevel: L.rankOrder,
        leagueCount: L.leagueSlots,
        maxLeagues: Math.max(L.leagueSlots, 4),
      },
    })
  }

  if (namingMode === 'auto' || namingMode === 'hybrid') {
    await prisma.zombieNameRecord.create({
      data: {
        universeId: universe.id,
        entityType: 'universe',
        entityId: universe.id,
        generatedName: baseName,
        finalName: baseName,
        wasEdited: Boolean(config.name?.trim()),
        namingMode,
      },
    })
  }

  return prisma.zombieUniverse.findUniqueOrThrow({
    where: { id: universe.id },
    include: { levels: { orderBy: { rankOrder: 'desc' } } },
  })
}

/**
 * Attach horde metadata to an existing redraft `League` row (must already exist).
 */
export async function createZombieLeague(
  config: ZombieLeagueSetupConfig,
  universeId?: string | null,
  tierId?: string | null,
  db: Prisma.TransactionClient = prisma,
) {
  const sport = normalizeToSupportedSport(config.sport)
  const schedule = getZombieSeasonSchedule(sport)
  const allowedTeamCounts = new Set(getZombieCreationTeamCounts(sport))
  const defaultTeamCount = ZOMBIE_DEFAULT_MANAGERS
  const resolvedTeamCount =
    typeof config.teamCount === 'number' && allowedTeamCounts.has(config.teamCount)
      ? config.teamCount
      : defaultTeamCount
  const existing = await db.league.findUnique({ where: { id: config.leagueId } })
  if (!existing) throw new Error('League not found — create the fantasy league first.')

  const { leagueId } = config

  if (universeId) {
    const names = (
      await db.zombieLeague.findMany({
        where: { universeId },
        select: { name: true },
      })
    )
      .map((z) => z.name)
      .filter(Boolean) as string[]
    const desired =
      config.name?.trim() ||
      generateLeagueName(names, config.namingMode === 'auto' ? 'A' : undefined)
    const collision = await db.zombieLeague.findFirst({
      where: { universeId, name: desired },
    })
    if (collision) throw new Error('League name must be unique within the universe.')
  }

  const namingMode = config.namingMode ?? 'hybrid'
  const nm =
    config.name?.trim() ||
    (namingMode === 'auto' || namingMode === 'hybrid'
      ? generateLeagueName(
          (
            await db.zombieLeague.findMany({
              where: universeId ? { universeId } : {},
              select: { name: true },
            })
          )
            .map((z) => z.name)
            .filter(Boolean) as string[],
        )
      : 'Zombie League')

  const experienceMode = config.experienceMode ?? 'enhanced'
  const row = await db.zombieLeague.create({
    data: {
      universeId: universeId ?? null,
      levelId: tierId ?? null,
      leagueId,
      name: nm,
      slug: config.slug ?? '',
      sport,
      season: config.season ?? existing.season ?? new Date().getFullYear(),
      experienceMode,
      whispererAmbushCount: experienceMode === 'simple' ? 0 : 3,
      whispererCount: experienceMode === 'simple' ? 1 : (config.whispererCount ?? 1),
      isSingleLeague: config.isSingleLeague ?? !universeId,
      isPaid: config.isPaid ?? false,
      status: 'setup',
      teamCount: resolvedTeamCount,
      whispererSelectionMode: config.whispererSelectionMode ?? 'random',
      namingMode,
      commissionerId: existing.userId,
      buyInAmount: config.buyInAmount ?? null,
      themeLabel: config.backgroundTheme ?? getRandomZombieTheme(),
      totalWeeks: schedule.totalWeeks,
      seasonStartWeek: schedule.infectionStartWeek,
      weeklyUpdateDay: schedule.weeklyUpdateDayOfWeek,
      weeklyUpdateHour: schedule.automationHourUtc,
    },
  })

  await db.zombieLeagueConfig.upsert({
    where: { leagueId },
    create: { leagueId, ...zombieExperienceDefaults(experienceMode) },
    update: zombieExperienceDefaults(experienceMode),
  })

  if (row.isPaid && config.buyInAmount != null) {
    await db.zombiePaidConfig.create({
      data: {
        zombieLeagueId: row.id,
        buyInAmount: config.buyInAmount,
      },
    })
  }

  if (namingMode === 'auto' || namingMode === 'hybrid') {
    await db.zombieNameRecord.create({
      data: {
        universeId: universeId ?? null,
        leagueId: row.id,
        entityType: 'league',
        entityId: row.id,
        generatedName: nm,
        finalName: nm,
        wasEdited: Boolean(config.name?.trim()),
        namingMode,
      },
    })
  }

  return row
}

export async function openRegistration(zombieLeagueId: string): Promise<void> {
  const z = await prisma.zombieLeague.update({
    where: { id: zombieLeagueId },
    data: { status: 'registering' },
  })
  await prisma.zombieAnnouncement.create({
    data: {
      zombieLeagueId,
      type: 'welcome',
      title: 'Registration open',
      content: 'The horde is assembling — registration is open for this league.',
      universeId: z.universeId,
    },
  })
}

export async function assignTeams(zombieLeagueId: string): Promise<void> {
  const z = await prisma.zombieLeague.findUnique({
    where: { id: zombieLeagueId },
    include: { league: true },
  })
  if (!z?.league) throw new Error('Zombie league not found')

  const rosters = await prisma.roster.findMany({ where: { leagueId: z.leagueId } })
  const hist = [{ week: 0, status: 'survivor' as const }]
  for (const r of rosters) {
    await prisma.zombieLeagueTeam.upsert({
      where: { leagueId_rosterId: { leagueId: z.leagueId, rosterId: r.id } },
      create: {
        leagueId: z.leagueId,
        zombieLeagueId: z.id,
        rosterId: r.id,
        status: 'Survivor',
        displayName: r.platformUserId,
        statusHistory: hist,
      },
      update: {
        zombieLeagueId: z.id,
        statusHistory: hist,
      },
    })
  }
}
