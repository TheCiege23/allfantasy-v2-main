import 'server-only'

import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { prisma } from '@/lib/prisma'
import { afcRosterId, afcTeams, isAfcSeed, resolveAfcChampionships, validAfcPairings, type AfcSeed } from './bracket'

const pilotLeagueId = 'a21a0001-1aa4-4040-a001-202611210000'
const pilotSeason = 2026
const settingsKey = 'staging_afc_championships'
const seedList = Object.keys(afcTeams).map(Number).filter(isAfcSeed)
const seedInput = z.custom<AfcSeed>(value => typeof value === 'number' && isAfcSeed(value))
const pairing = z.object({ away: seedInput, home: seedInput })
const configSchema = z.object({
  revision: z.number().int().nonnegative(),
  overrides: z.record(z.string(), z.array(pairing).max(8)),
})
export const afcOverrideInput = z.object({
  round: z.number().int().min(1).max(5),
  revision: z.number().int().nonnegative(),
  pairings: z.array(pairing).max(8).nullable(),
})

export function isAfcPilotLeague(leagueId: string) {
  return process.env.RAILWAY_PROJECT_ID === 'bb9805c9-f83a-4e3d-a5dd-cf3214436fbf' &&
    process.env.RAILWAY_ENVIRONMENT_ID === 'd23b2377-5944-44e7-bba5-57804006fd91' && leagueId === pilotLeagueId
}

export async function loadAfcPilot(leagueId: string, userId: string) {
  if (!isAfcPilotLeague(leagueId)) return null
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, userId: true, season: true, settings: true, platform: true, sport: true, updatedAt: true },
  })
  return league && league.userId === userId && league.season === pilotSeason &&
    league.sport === 'NFL' && isNativePlatform(league.platform) ? league : null
}

type Pilot = NonNullable<Awaited<ReturnType<typeof loadAfcPilot>>>
type Store = Pick<Prisma.TransactionClient, 'teamWeekResult'>

function settingsObject(settings: Prisma.JsonValue) {
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {}
}

export async function afcSnapshot(pilot: Pilot, store: Store = prisma) {
  const config = configSchema.safeParse(settingsObject(pilot.settings)[settingsKey])
  if (!config.success) return null
  const seedByRoster = new Map(seedList.map(seed => [afcRosterId(seed), seed]))
  const rows = await store.teamWeekResult.findMany({
    where: { leagueId: pilot.id, season: pilot.season, week: { gte: 9, lte: 13 }, rosterId: { in: [...seedByRoster.keys()] } },
    select: { week: true, rosterId: true, totalPoints: true, status: true },
  })
  const scores = rows.flatMap(row => {
    const seed = seedByRoster.get(row.rosterId)
    return seed == null ? [] : [{ week: row.week, seed, points: row.totalPoints, final: row.status === 'final' }]
  })
  return { leagueId: pilot.id, season: pilot.season, revision: config.data.revision, rounds: resolveAfcChampionships(scores, config.data.overrides) }
}

// A staging replay of the confirmed opening rounds. Subsequent rounds use AF roster results.
const openingResults: readonly (readonly [number, AfcSeed, number, AfcSeed, number])[] = [
  [9, 34, 77.2, 33, 93.5],
  [10, 33, 128.1, 4, 164.35],
  [10, 27, 60.8, 2, 100.35],
  [10, 23, 111.75, 5, 98.1],
  [10, 17, 131.8, 6, 179.55],
  [10, 18, 95.6, 9, 155.55],
  [10, 24, 88.8, 7, 136.25],
  [10, 15, 128.7, 8, 165.1],
  [10, 12, 130.9, 11, 152.85],
]

class AfcConflict extends Error {}

async function updateConfig(tx: Prisma.TransactionClient, pilot: Pilot, config: z.infer<typeof configSchema>) {
  const changed = await tx.league.updateMany({
    where: { id: pilot.id, updatedAt: pilot.updatedAt, userId: pilot.userId },
    data: { settings: { ...settingsObject(pilot.settings), [settingsKey]: config } as Prisma.InputJsonObject },
  })
  if (!changed.count) throw new AfcConflict('The bracket changed. Refresh and try again.')
}

export async function initializeAfcPilot(pilot: Pilot) {
  if (configSchema.safeParse(settingsObject(pilot.settings)[settingsKey]).success) return
  await prisma.$transaction(async tx => {
    await updateConfig(tx, pilot, { revision: 0, overrides: {} })
    await tx.roster.createMany({
      data: seedList.map(seed => ({
        id: afcRosterId(seed), leagueId: pilot.id, platformUserId: `afc-pilot-${seed}`,
        playerData: { teamName: afcTeams[seed], players: [], starters: [] },
      })),
      skipDuplicates: true,
    })
    await tx.teamWeekResult.createMany({
      data: openingResults.flatMap(([week, away, awayPoints, home, homePoints]) => [
        { week, seed: away, points: awayPoints }, { week, seed: home, points: homePoints },
      ]).map(({ week, seed, points }) => ({
        leagueId: pilot.id, season: pilot.season, week, rosterId: afcRosterId(seed), totalPoints: points, status: 'final',
      })),
      skipDuplicates: true,
    })
  })
}

export async function prepareAfcStagingReplay() {
  if (!isAfcPilotLeague(pilotLeagueId) || process.env.RAILWAY_SERVICE_ID !== 'd523cabc-45f2-474f-b991-2e5e54f2920f') return
  const owner = await prisma.league.findUnique({ where: { id: pilotLeagueId }, select: { userId: true } })
  if (!owner?.userId) return
  const pilot = await loadAfcPilot(pilotLeagueId, owner.userId)
  if (pilot) await initializeAfcPilot(pilot)
}

export async function saveAfcOverride(pilot: Pilot, input: z.infer<typeof afcOverrideInput>) {
  await prisma.$transaction(async tx => {
    const config = configSchema.safeParse(settingsObject(pilot.settings)[settingsKey])
    const snapshot = await afcSnapshot(pilot, tx)
    const round = snapshot?.rounds[input.round - 1]
    if (!config.success || !round || config.data.revision !== input.revision) throw new AfcConflict('The bracket changed. Refresh and try again.')
    if (!round.canOverride) throw new AfcConflict('Pairings can be changed after all teams advance and before scoring starts.')
    if (input.pairings && !validAfcPairings(round.defaults, input.pairings)) {
      throw new AfcConflict('Use every eligible team exactly once.')
    }
    const overrides = { ...config.data.overrides }
    if (input.pairings) overrides[input.round] = input.pairings
    else delete overrides[input.round]
    await updateConfig(tx, pilot, { revision: config.data.revision + 1, overrides })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })
}

export function afcConflictMessage(error: unknown) {
  if (error instanceof AfcConflict) return error.message
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return 'The bracket changed. Refresh and try again.'
  return null
}
