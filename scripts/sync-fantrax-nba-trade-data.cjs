/**
 * Sync public Fantrax NBA roster identities and Rolling Insights season totals
 * for trade evaluation. Staging only; dry-run unless --apply is supplied.
 *
 * node scripts/sync-fantrax-nba-trade-data.cjs 51isdapqmt6atvdz
 * node scripts/sync-fantrax-nba-trade-data.cjs 51isdapqmt6atvdz --apply
 */
const fs = require('node:fs')
const dotenv = require('dotenv')
const { identifyTarget } = require('./db-target-identity.cjs')

const STAT_KEYS = ['points', 'total_rebounds', 'assists', 'steals', 'blocks', 'turnovers']
const normalizeName = (value) => String(value ?? '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const fantraxName = (value) => {
  const parts = String(value ?? '').split(',')
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : value
}

function seasonStats(row) {
  const stats = row?.regular_season
  const games = Number(stats?.games_played)
  if (!row?.player_id || !row?.player || !Number.isInteger(games) || games < 1 ||
    !STAT_KEYS.every((key) => Number.isFinite(Number(stats?.[key])) && stats?.[key] != null)) return null
  return { playerId: String(row.player_id), playerName: String(row.player), gamesPlayed: games, stats }
}

async function fetchRiSeason(season, credentials) {
  const statuses = []
  for (const [label, token] of credentials) {
    const url = new URL(`https://rest.datafeeds.rolling-insights.com/api/v1/player-stats/${season}/NBA`)
    url.searchParams.set('RSC_token', token)
    url.searchParams.set('_', String(Date.now()))
    const response = await fetch(url, { headers: { Accept: 'application/json',
      'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' }, signal: AbortSignal.timeout(30000) })
    statuses.push({ credential: label, status: response.status })
    if (!response.ok) continue
    const payload = await response.json()
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data?.NBA) ? payload.data.NBA :
      Array.isArray(payload?.NBA) ? payload.NBA : Array.isArray(payload?.data) ? payload.data : null
    if (!rows) throw new Error('RI_UNRECOGNIZED_ENVELOPE')
    return { rows, statuses }
  }
  throw new Error(`RI_SEASON_UNAVAILABLE_${season}_${statuses.map((item) => item.status).join('_')}`)
}

async function fantraxJson(path) {
  const response = await fetch(`https://www.fantrax.com/fxea/general/${path}`, {
    signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error('FANTRAX_HTTP_ERROR')
  const payload = await response.json()
  if (!payload || typeof payload !== 'object' || payload.error) throw new Error('FANTRAX_API_ERROR')
  return payload
}

function planLinks(rosterIds, directory, identities, seasonRows) {
  const byName = new Map()
  for (const identity of identities) {
    const key = normalizeName(identity.canonicalName)
    byName.set(key, [...(byName.get(key) ?? []), identity])
  }
  const riNames = new Map()
  for (const row of seasonRows) {
    const key = String(row.player_id)
    riNames.set(key, new Set([...(riNames.get(key) ?? []), normalizeName(row.player)]))
  }
  const usedIdentityIds = new Set()
  const links = []
  const skipped = { noUniqueName: 0, noProviderProof: 0, conflictingLink: 0 }
  for (const fantraxId of rosterIds) {
    const wantedName = normalizeName(fantraxName(directory[fantraxId]?.name))
    const candidates = byName.get(wantedName) ?? []
    if (!wantedName || candidates.length !== 1) { skipped.noUniqueName++; continue }
    const identity = candidates[0]
    if (!identity.rollingInsightsId || !riNames.get(identity.rollingInsightsId)?.has(wantedName)) {
      skipped.noProviderProof++; continue
    }
    if ((identity.fantraxId && identity.fantraxId !== fantraxId) || usedIdentityIds.has(identity.id) ||
      identities.some((other) => other.id !== identity.id && other.fantraxId === fantraxId)) {
      skipped.conflictingLink++; continue
    }
    usedIdentityIds.add(identity.id)
    links.push({ id: identity.id, fantraxId, unchanged: identity.fantraxId === fantraxId })
  }
  return { links, skipped }
}

async function main() {
  const leagueId = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!/^[a-z0-9]{16}$/.test(leagueId ?? '')) throw new Error('INVALID_LEAGUE_ID')
  const env = dotenv.parse(fs.readFileSync('.env.staging'))
  const databaseUrl = env.DIRECT_URL || env.DATABASE_URL
  if (identifyTarget(databaseUrl).label !== 'staging') throw new Error('STAGING_DATABASE_REQUIRED')
  // The vendor subscription may be in the production env file; only its token is reused.
  const fallback = fs.existsSync('.env') ? dotenv.parse(fs.readFileSync('.env')) : {}
  const credentials = [
    ['secondary', env.ROLLING_INSIGHTS_RSC_TOKEN2 || fallback.ROLLING_INSIGHTS_RSC_TOKEN2 ||
      env.ROLLING_INSIGHTS_CLIENT_SECRET2 || fallback.ROLLING_INSIGHTS_CLIENT_SECRET2],
    ['primary', env.ROLLING_INSIGHTS_RSC_TOKEN || fallback.ROLLING_INSIGHTS_RSC_TOKEN ||
      env.RSC_TOKEN || fallback.RSC_TOKEN || env.ROLLING_INSIGHTS_CLIENT_SECRET ||
      fallback.ROLLING_INSIGHTS_CLIENT_SECRET],
  ].filter(([, token]) => token)
  if (!credentials.length) throw new Error('NO_RI_TOKEN')

  const [{ rows: previousRows, statuses: previousStatus },
    { rows: currentRows, statuses: currentStatus }, rosterPayload, directory] = await Promise.all([
    fetchRiSeason('2025', credentials), fetchRiSeason('2026', credentials),
    fantraxJson(`getTeamRosters?leagueId=${encodeURIComponent(leagueId)}`),
    fantraxJson('getPlayerIds?sport=NBA'),
  ])
  const rosters = rosterPayload.rosters ?? rosterPayload
  const rosterIds = [...new Set(Object.values(rosters).flatMap((team) =>
    Array.isArray(team.rosterItems) ? team.rosterItems.map((item) => String(item.id ?? '')) : []))]
    .filter(Boolean)
  if (!rosterIds.length || rosterIds.some((id) => !directory[id])) throw new Error('FANTRAX_ROSTER_DIRECTORY_MISMATCH')
  const { PrismaClient } = require('@prisma/client')
  const db = new PrismaClient({ datasourceUrl: databaseUrl, log: [] })
  try {
    const identities = await db.playerIdentityMap.findMany({ where: { sport: 'NBA' },
      select: { id: true, canonicalName: true, rollingInsightsId: true, fantraxId: true,
        position: true, currentTeam: true } })
    const plan = planLinks(rosterIds, directory, identities, [...previousRows, ...currentRows])
    const identityByRiId = new Map(identities.filter((row) => row.rollingInsightsId)
      .map((row) => [row.rollingInsightsId, row]))
    const seasons = [['2025', previousRows], ['2026', currentRows]]
    const writes = seasons.flatMap(([season, rows]) => rows.flatMap((row) => {
      const valid = seasonStats(row)
      const identity = identityByRiId.get(valid?.playerId)
      return valid && identity ? [{ ...valid, season, position: identity.position,
        team: identity.currentTeam }] : []
    }))
    const report = { target: 'staging', mode: apply ? 'apply' : 'dry-run', leagueId,
      rosterIds: rosterIds.length, linkedRosterIds: plan.links.length,
      newLinks: plan.links.filter((link) => !link.unchanged).length,
      skipped: plan.skipped, seasonRows: { 2025: previousRows.length, 2026: currentRows.length },
      validMatchedStatRows: writes.length, providerStatus: { 2025: previousStatus, 2026: currentStatus } }
    if (apply) {
      for (const link of plan.links.filter((item) => !item.unchanged)) {
        const updated = await db.playerIdentityMap.updateMany({ where: { id: link.id, fantraxId: null },
          data: { fantraxId: link.fantraxId } })
        if (updated.count !== 1) throw new Error('IDENTITY_CHANGED_DURING_SYNC')
      }
      const now = new Date()
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      for (const row of writes) {
        const key = { sport: 'NBA', playerId: row.playerId, season: row.season,
          seasonType: 'regular', source: 'rolling_insights' }
        const values = { playerName: row.playerName, position: row.position, team: row.team,
          stats: row.stats, gamesPlayed: row.gamesPlayed, fetchedAt: now, expiresAt }
        await db.playerSeasonStats.upsert({ where: { sport_playerId_season_seasonType_source: key },
          create: { ...key, ...values }, update: values })
      }
    }
    console.log(JSON.stringify(report, null, 2))
  } finally { await db.$disconnect() }
}

if (require.main === module) main().catch((error) => {
  console.error(JSON.stringify({ failed: true, code: error?.code || error?.message || 'SYNC_FAILED' }))
  process.exitCode = 1
})
module.exports = { seasonStats, planLinks }
