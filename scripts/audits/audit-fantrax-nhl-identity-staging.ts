/** Read-only identity coverage for an imported Fantrax NHL league. */
import assert from 'node:assert/strict'
import { prisma } from '@/lib/prisma'
import { getFantraxPlayerIds } from '@/lib/league-import/fantrax/fantraxApi'
import { planProFantraxIdentityLinks } from '@/lib/player-identity/proFantraxIdentityPlan'
import { parseNhlFantraxUniverse, NHL_FANTRAX_UNIVERSE_CACHE_KEY } from '@/lib/player-identity/nhlFantraxProspects'
import targetGuard from '../db-target-identity.cjs'

async function main() {
  const leagueId = process.argv[2]
  assert.match(leagueId ?? '', /^[0-9a-f-]{36}$/i, 'LEAGUE_UUID_REQUIRED')
  assert.equal(targetGuard.identifyTarget(process.env.DIRECT_URL || process.env.DATABASE_URL).label,
    'staging', 'STAGING_DATABASE_REQUIRED')
  const [league, cache, rosters, identities] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true, settings: true } }),
    prisma.sportsDataCache.findUnique({ where: { cacheKey: NHL_FANTRAX_UNIVERSE_CACHE_KEY }, select: { data: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { playerData: true } }),
    prisma.playerIdentityMap.findMany({ where: { sport: 'NHL' }, select: {
      id: true, canonicalName: true, currentTeam: true, position: true, fantraxId: true, rollingInsightsId: true,
    } }),
  ])
  assert.equal(league?.platform, 'fantrax')
  assert.equal(league?.sport, 'NHL')
  const universe = parseNhlFantraxUniverse(cache?.data)
  const ids = new Set(rosters.flatMap((roster) => {
    const data = roster.playerData as { players?: unknown } | null
    return Array.isArray(data?.players) ? data.players.filter((id): id is string => typeof id === 'string') : []
  }))
  const source = universe?.rows.map(([fantraxId, name, team, position]) =>
    ({ fantraxId, name, team, position })) ?? null
  const live = source ? null : await getFantraxPlayerIds('NHL')
  if (!source && !live?.ok) throw new Error('FANTRAX_NHL_PLAYER_MAP_REQUIRED')
  const refs = (source ?? (live?.ok ? Object.values(live.data) : [])).filter((ref) => ids.has(ref.fantraxId))
  const plan = planProFantraxIdentityLinks('NHL', refs, identities)
  const settings = league?.settings as Record<string, unknown> | null
  const scoring = (settings?.scoringSettings as { rules?: Record<string, number>; rulesDetail?: unknown } | null)?.rules ?? {}
  const sourceSystem = (settings?.fantrax_settings as { scoringSystem?: { scoringCategorySettings?: unknown[] } } | null)?.scoringSystem
  const sourceConfigs = (sourceSystem?.scoringCategorySettings ?? []).flatMap((entry) => {
    const group = entry as { group?: { code?: string }; configs?: Array<{ scoringCategory?: { code?: string }; points?: unknown; position?: { shortName?: string; code?: string } }> }
    return (group.configs ?? []).map((config) => ({ group: group.group?.code,
      code: config.scoringCategory?.code, points: config.points,
      position: config.position?.shortName ?? config.position?.code }))
  })
  const sampleBoxes = await prisma.playerGameStat.findMany({ where: { sportType: 'NHL',
    gameDate: new Date('2026-10-19T00:00:00Z') }, take: 2,
    select: { gameId: true, normalizedStatMap: true } })
  console.log(JSON.stringify({ rosterCount: rosters.length, rosteredIds: ids.size, refs: refs.length,
    proposed: plan.links.length, unmatched: plan.unmatched, ambiguous: plan.ambiguous,
    unchanged: plan.unchanged, conflicts: plan.conflicts,
    scoring, settingsKeys: Object.keys(settings ?? {}),
    sourceConfigs,
    fantraxSettingsKeys: Object.keys(settings?.fantrax_settings as Record<string, unknown> ?? {}),
    rulesDetail: (settings?.scoringSettings as { rulesDetail?: unknown } | null)?.rulesDetail,
    sampleBoxKeys: sampleBoxes.map((box) => ({ gameId: box.gameId,
      keys: Object.keys((box.normalizedStatMap as { stats?: Record<string, unknown> } | null)?.stats ?? {}) })),
    examples: plan.links.slice(0, 5).map((link) => ({ fantraxId: link.fantraxId, id: link.id })) }, null, 2))
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
