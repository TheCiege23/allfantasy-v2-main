/**
 * Read-only preflight for a public Fantrax NBA league and a named database.
 * Prints counts only: no player/team names, IDs, or credentials.
 *
 * node scripts/audits/fantrax-nba-league-readiness.cjs .env.staging LEAGUE_ID
 * node scripts/audits/fantrax-nba-league-readiness.cjs .env LEAGUE_ID --production-readonly
 */
const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const { identifyTarget } = require('../db-target-identity.cjs')

const ID_FIELDS = ['id', 'fantraxId', 'sleeperId', 'rollingInsightsId', 'espnId']
const STAT_ALIASES = {
  pts: ['points', 'points_scored', 'pts'],
  reb: ['rebounds', 'rebound', 'total_rebounds', 'reb'],
  ast: ['assists', 'assist', 'ast'],
  stl: ['steals', 'steal', 'stl'],
  blk: ['blocks', 'block', 'blk'],
  to: ['turnovers', 'turnover', 'to', 'tov'],
}
const CAPTURED_WEIGHTS = {
  INDIVIDUAL_POINTS: 1,
  INDIVIDUAL_REBOUNDS: 1.25,
  INDIVIDUAL_ASSISTS: 1.5,
  INDIVIDUAL_STEALS: 2,
  INDIVIDUAL_BLOCKS: 2,
  INDIVIDUAL_TURNOVERS: -1,
}
const nameKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const fantraxNameKey = (name) => {
  const parts = String(name ?? '').split(',')
  return nameKey(parts.length === 2 ? `${parts[1]} ${parts[0]}` : name)
}
const positions = (value) => new Set(String(value ?? '').toUpperCase().split(/[,/;\s]+/).filter(Boolean))

function statComplete(stats, keys) {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return false
  return keys.every((key) => STAT_ALIASES[key]?.some((alias) => {
    const value = stats[alias]
    return (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
  }))
}

async function getJson(pathname) {
  const response = await fetch(`https://www.fantrax.com/fxea/general/${pathname}`, {
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error('FANTRAX_HTTP_ERROR')
  const data = await response.json()
  if (!data || typeof data !== 'object' || data.error) throw new Error('FANTRAX_API_ERROR')
  return data
}

async function main() {
  const [envArg, leagueId] = process.argv.slice(2)
  if (!envArg || !/^[a-z0-9]{16}$/.test(leagueId ?? '')) throw new Error('INVALID_ARGUMENTS')
  const env = dotenv.parse(fs.readFileSync(path.resolve(envArg)))
  const url = env.DIRECT_URL || env.DATABASE_URL
  const target = identifyTarget(url)
  if (target.kind !== 'safe' && !(target.kind === 'production' &&
    process.argv.includes('--production-readonly'))) throw new Error('UNSAFE_DATABASE_TARGET')

  const [info, rosterResponse, directory] = await Promise.all([
    getJson(`getLeagueInfo?leagueId=${encodeURIComponent(leagueId)}`),
    getJson(`getTeamRosters?leagueId=${encodeURIComponent(leagueId)}`),
    getJson('getPlayerIds?sport=NBA'),
  ])
  const rosters = rosterResponse.rosters ?? rosterResponse
  const teams = Object.values(rosters)
  const rosterIds = [...new Set(teams.flatMap((team) =>
    Array.isArray(team.rosterItems) ? team.rosterItems.map((item) => String(item.id ?? '')) : []))]
    .filter(Boolean)
  const configs = (info.scoringSystem?.scoringCategorySettings ?? []).flatMap((group) => group.configs ?? [])
  const codes = configs.map((item) => item.scoringCategory?.code)
  const capturedScoringMatches = info.scoringSystem?.type === 'HEAD_TO_HEAD_POINTS_BASED' &&
    codes.length === 6 && new Set(codes).size === 6 && configs.every((item) =>
      Object.hasOwn(CAPTURED_WEIGHTS, item.scoringCategory?.code) &&
      item.points === CAPTURED_WEIGHTS[item.scoringCategory.code] &&
      String(item.position?.shortName ?? '').toUpperCase() === 'DEFAULT')

  process.env.DATABASE_URL = url
  process.env.DIRECT_URL = url
  const { PrismaClient } = require('@prisma/client')
  const db = new PrismaClient({ datasourceUrl: url, log: [] })
  try {
    const database = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      const [storedLeagueCount, linkedLeagueCount, snapshots, connectedFantraxAccounts,
        nbaIdentityRows, nbaSeasonRows, identities] = await Promise.all([
        tx.league.count({ where: { platform: 'fantrax', platformLeagueId: leagueId, sport: 'NBA' } }),
        tx.league.count({ where: { platform: 'fantrax', sport: 'NBA',
          settings: { path: ['fantraxSourceLeagueId'], equals: leagueId } } }),
        tx.fantraxLeague.findMany({ where: { sourceLeagueId: leagueId }, select: { id: true } }),
        tx.leagueAuth.count({ where: { platform: 'fantrax', apiKey: { not: null } } }),
        tx.playerIdentityMap.count({ where: { sport: 'NBA' } }),
        tx.playerSeasonStats.count({ where: { sport: 'NBA', seasonType: 'regular', gamesPlayed: { gt: 0 } } }),
        tx.playerIdentityMap.findMany({
          where: { sport: 'NBA', OR: ID_FIELDS.map((field) => ({ [field]: { in: rosterIds } })) },
          select: Object.fromEntries([...ID_FIELDS, 'position'].map((field) => [field, true])),
        }),
      ])
      const legacySnapshotLeagueCount = snapshots.length ? await tx.league.count({
        where: { platform: 'fantrax', sport: 'NBA',
          platformLeagueId: { in: snapshots.map((snapshot) => snapshot.id) } },
      }) : 0
      const matches = new Map(rosterIds.map((id) => [id, new Map()]))
      for (const identity of identities) for (const field of ID_FIELDS) {
        const id = identity[field]
        if (matches.has(id)) matches.get(id).set(identity.id, identity)
      }
      const resolved = rosterIds.filter((id) => matches.get(id).size === 1)
      const ambiguous = rosterIds.filter((id) => matches.get(id).size > 1)
      const missingIds = rosterIds.filter((id) => matches.get(id).size === 0)
      const candidateSummary = { uniqueNamePositionTeam: 0, uniqueNamePositionOnly: 0,
        noUniqueNamePosition: 0, conflictingFantraxId: 0 }
      if (missingIds.length) {
        const registry = await tx.playerIdentityMap.findMany({ where: { sport: 'NBA' },
          select: { canonicalName: true, position: true, currentTeam: true, fantraxId: true } })
        const byName = new Map()
        for (const identity of registry) {
          const key = nameKey(identity.canonicalName)
          byName.set(key, [...(byName.get(key) ?? []), identity])
        }
        for (const id of missingIds) {
          const ref = directory[id]
          const wantedPositions = positions(ref?.position)
          const candidates = (byName.get(fantraxNameKey(ref?.name)) ?? []).filter((identity) =>
            [...positions(identity.position)].some((position) => wantedPositions.has(position)))
          if (candidates.length !== 1) { candidateSummary.noUniqueNamePosition++; continue }
          if (candidates[0].fantraxId && candidates[0].fantraxId !== id) {
            candidateSummary.conflictingFantraxId++
            continue
          }
          const sameTeam = String(ref?.team ?? '').trim().toUpperCase() ===
            String(candidates[0].currentTeam ?? '').trim().toUpperCase()
          if (sameTeam && ref?.team) candidateSummary.uniqueNamePositionTeam++
          else candidateSummary.uniqueNamePositionOnly++
        }
      }
      const matchedIdentities = [...new Map(resolved.map((id) => {
        const identity = [...matches.get(id).values()][0]
        return [identity.id, identity]
      })).values()]
      const statIds = [...new Set(matchedIdentities.flatMap((identity) =>
        ID_FIELDS.map((field) => identity[field]).filter(Boolean)))]
      const seasonRows = statIds.length ? await tx.playerSeasonStats.findMany({
        where: { sport: 'NBA', seasonType: 'regular', playerId: { in: statIds } },
        select: { playerId: true, season: true, stats: true, gamesPlayed: true, fetchedAt: true },
        orderBy: [{ season: 'desc' }, { fetchedAt: 'desc' }],
      }) : []
      const complete = matchedIdentities.filter((identity) => {
        const ids = new Set(ID_FIELDS.map((field) => identity[field]).filter(Boolean))
        const latest = seasonRows.find((row) => ids.has(row.playerId))
        return latest?.gamesPlayed > 0 && statComplete(latest.stats, ['pts', 'reb', 'ast', 'stl', 'blk', 'to'])
      })
      return {
        storedLeagueCount, linkedLeagueCount, snapshotCount: snapshots.length,
        legacySnapshotLeagueCount, connectedFantraxAccounts,
        nbaIdentityRows, nbaSeasonRows,
        identityMatched: resolved.length, identityAmbiguous: ambiguous.length,
        identityMissing: missingIds.length, missingCandidateSummary: candidateSummary,
        matchedWithCompleteLatestSeasonStats: complete.length,
      }
    }, { timeout: 120000, maxWait: 10000 })
    console.log(JSON.stringify({
      target: target.label, readOnly: true, scoringMode: info.scoringSystem?.type ?? null,
      capturedScoringMatches, teamCount: teams.length, rosterPlayerIds: rosterIds.length,
      nbaDirectoryMatches: rosterIds.filter((id) => directory[id]).length,
      ...database,
    }, null, 2))
  } finally { await db.$disconnect() }
}

if (require.main === module) main().catch((error) => {
  console.error(JSON.stringify({ failed: true, code: error.code || error.name || 'AUDIT_FAILED' }))
  process.exitCode = 1
})

module.exports = { statComplete, fantraxNameKey }
