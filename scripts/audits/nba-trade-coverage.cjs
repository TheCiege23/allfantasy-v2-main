/**
 * Read-only NBA trade-evaluator coverage audit.
 *
 * Run: node scripts/audits/nba-trade-coverage.cjs .env.staging
 * Production read-only: node scripts/audits/nba-trade-coverage.cjs .env --production-readonly
 * Requires an explicitly named, known target. Production additionally requires
 * the flag above. Never prints player names, credentials, or raw IDs. Every
 * database query runs in a read-only transaction.
 */
const fs = require('node:fs')
const path = require('node:path')
const dotenv = require('dotenv')
const { identifyTarget } = require('../db-target-identity.cjs')

const CURRENT_FIELDS = ['id', 'sleeperId', 'rollingInsightsId', 'espnId', 'fantraxId']
const EXTRA_FIELDS = ['apiSportsId', 'fantasyCalcId', 'clearSportsId', 'fleaflickerId', 'mflId']
const ALL_FIELDS = [...CURRENT_FIELDS, ...EXTRA_FIELDS]
const NATIVE = new Set(['native', 'af', 'allfantasy'])
const source = (platform) => NATIVE.has(String(platform).toLowerCase()) ? 'native' : String(platform).toLowerCase()
const nameKey = (name) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const positionSet = (value) => new Set(String(value ?? '').toUpperCase().split(/[,/;\s]+/).filter(Boolean))

function sourceTeamId(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const direct = data.source_team_id
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (typeof direct === 'number' && Number.isFinite(direct)) return String(direct)
  const nested = data.import?.sourceTeamId
  return typeof nested === 'string' && nested.trim() ? nested.trim() : null
}

function rosterIds(data) {
  const rows = Array.isArray(data) ? data : data?.players
  if (!Array.isArray(rows) || !rows.length) return null
  const ids = rows.map((row) => {
    const raw = typeof row === 'string' || typeof row === 'number' ? row
      : row && typeof row === 'object' && !Array.isArray(row) ? row.id ?? row.player_id : null
    return typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : ''
  })
  return ids.some((id) => !id) ? null : [...new Set(ids)]
}

function chunks(rows, size = 350) {
  const result = []
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size))
  return result
}

function leagueHasPointsRules(league) {
  const settings = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
    ? league.settings : {}
  const canonical = settings.scoringSettings && typeof settings.scoringSettings === 'object'
    ? settings.scoringSettings : {}
  const mode = String(canonical.scoringMode ?? settings.scoring_mode ?? league.scoring ?? '')
    .trim().toLowerCase().replace(/[\s-]+/g, '_')
  const rules = canonical.rules && typeof canonical.rules === 'object' ? canonical.rules : settings.scoring_settings
  return ['points', 'h2h_points', 'standard', 'ppr', 'half_ppr'].includes(mode) && rules && typeof rules === 'object' &&
    Object.values(rules).some((weight) => typeof weight === 'number' && Number.isFinite(weight))
}

function scoringKind(league) {
  const settings = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
    ? league.settings : {}
  const canonical = settings.scoringSettings && typeof settings.scoringSettings === 'object'
    ? settings.scoringSettings : {}
  const mode = String(canonical.scoringMode ?? settings.scoring_mode ?? league.scoring ?? '')
    .trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (['points', 'h2h_points', 'standard', 'ppr', 'half_ppr'].includes(mode)) return 'points'
  if (['h2h_category', 'h2h_categories', 'categories', 'category'].includes(mode)) return 'category'
  if (['roto', 'rotisserie'].includes(mode)) return 'roto'
  return 'unknown'
}

function starterIds(data) {
  const rows = Array.isArray(data?.starters) ? data.starters : data?.lineup_sections?.starters
  if (!Array.isArray(rows)) return []
  return rows.map((row) => typeof row === 'string' || typeof row === 'number' ? String(row)
    : row && typeof row === 'object' ? String(row.id ?? row.player_id ?? '') : '').filter(Boolean)
}

function summarize(rows, identities, seasons, sportsPlayers) {
  const byAlias = new Map()
  const byCanonicalId = new Map(identities.map((identity) => [identity.id, identity]))
  for (const identity of identities) for (const field of ALL_FIELDS) {
    const id = identity[field]
    if (!id) continue
    const matches = byAlias.get(id) ?? new Map()
    const fields = matches.get(identity.id) ?? new Set()
    fields.add(field)
    matches.set(identity.id, fields)
    byAlias.set(id, matches)
  }
  const seasonIds = new Set(seasons.map((row) => row.playerId))
  const sportsIds = new Set(sportsPlayers.map((row) => row.externalId))
  const report = {}
  for (const row of rows) {
    const bucket = report[row.platform] ??= {
      leagues: new Set(), pointsLeagues: new Set(), teams: 0, rosterMatched: 0,
      rosterMissing: 0, rosterDuplicate: 0, rosterEmpty: 0, rosterPlayers: 0,
      identityCurrent: 0, identityExtraOnly: 0, identityMissing: 0, identityAmbiguous: 0,
      missingWithSportsPlayer: 0, missingStarterIdentities: 0,
      positionMissing: 0, seasonMissing: 0,
      matchedByField: Object.fromEntries(ALL_FIELDS.map((field) => [field, 0])),
    }
    bucket.leagues.add(row.leagueId)
    if (row.pointsReady) bucket.pointsLeagues.add(row.leagueId)
    bucket.teams++
    if (row.rosterCount === 0) { bucket.rosterMissing++; continue }
    if (row.rosterCount > 1) { bucket.rosterDuplicate++; continue }
    bucket.rosterMatched++
    if (!row.ids?.length) { bucket.rosterEmpty++; continue }
    for (const id of row.ids) {
      bucket.rosterPlayers++
      const matches = byAlias.get(id)
      if (!matches?.size) {
        bucket.identityMissing++
        if (row.starterIds?.includes(id)) bucket.missingStarterIdentities++
        if (sportsIds.has(id)) bucket.missingWithSportsPlayer++
        continue
      }
      if (matches.size !== 1) { bucket.identityAmbiguous++; continue }
      const [canonicalId, fields] = [...matches][0]
      const current = [...fields].some((field) => CURRENT_FIELDS.includes(field))
      if (current) bucket.identityCurrent++
      else bucket.identityExtraOnly++
      for (const field of fields) bucket.matchedByField[field]++
      const identity = byCanonicalId.get(canonicalId)
      if (!identity?.position) bucket.positionMissing++
      if (!ALL_FIELDS.some((field) => identity?.[field] && seasonIds.has(identity[field]))) bucket.seasonMissing++
    }
  }
  return Object.fromEntries(Object.entries(report).map(([platform, bucket]) => [platform, {
    ...bucket, leagues: bucket.leagues.size, pointsLeagues: bucket.pointsLeagues.size,
  }]))
}

async function main() {
  const envArg = process.argv[2]
  if (!envArg) throw new Error('Name a known nonproduction env file, e.g. .env.staging')
  const envPath = path.resolve(envArg)
  const env = dotenv.parse(fs.readFileSync(envPath))
  const url = env.DATABASE_URL
  const target = identifyTarget(url)
  const productionReadOnly = process.argv.includes('--production-readonly')
  if (target.kind !== 'safe' && !(target.kind === 'production' && productionReadOnly)) {
    throw new Error(`Refusing ${target.kind} database target`)
  }
  // Set before Prisma import; the explicit datasourceUrl below is the authority.
  process.env.DATABASE_URL = url
  process.env.DIRECT_URL = env.DIRECT_URL || url
  const { PrismaClient } = require('@prisma/client')
  const db = new PrismaClient({ datasourceUrl: url, log: [] })
  try {
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      const leagues = await tx.league.findMany({
        where: { sport: 'NBA' }, select: { id: true, platformLeagueId: true, platform: true, settings: true, scoring: true },
      })
      const leagueIds = leagues.map((league) => league.id)
      if (!leagueIds.length) return { leagues: 0, report: {} }
      const leagueInventory = { native: { leagues: 0, pointsLeagues: 0, modes: {} },
        sleeper: { leagues: 0, pointsLeagues: 0, modes: {} },
        espn: { leagues: 0, pointsLeagues: 0, modes: {} },
        fantrax: { leagues: 0, pointsLeagues: 0, modes: {} } }
      for (const league of leagues) {
        const bucket = leagueInventory[source(league.platform)] ??= { leagues: 0, pointsLeagues: 0, modes: {} }
        bucket.leagues++
        if (leagueHasPointsRules(league)) bucket.pointsLeagues++
        const mode = scoringKind(league)
        bucket.modes[mode] = (bucket.modes[mode] ?? 0) + 1
      }
      const [teams, rosters] = await Promise.all([
        tx.leagueTeam.findMany({ where: { leagueId: { in: leagueIds } }, select: { leagueId: true, externalId: true } }),
        tx.roster.findMany({ where: { leagueId: { in: leagueIds } }, select: { id: true, leagueId: true, playerData: true, redraftRosterId: true } }),
      ])
      const leagueById = new Map(leagues.map((league) => [league.id, league]))
      const rosterByTeam = new Map()
      for (const roster of rosters) {
        const league = leagueById.get(roster.leagueId)
        const key = source(league.platform) === 'native' ? roster.id : sourceTeamId(roster.playerData)
        if (!key) continue
        const mapKey = `${roster.leagueId}\0${key}`
        rosterByTeam.set(mapKey, [...(rosterByTeam.get(mapKey) ?? []), roster])
      }
      const linkedIds = rosters.map((row) => row.redraftRosterId).filter(Boolean)
      const linkedPlayers = linkedIds.length ? await tx.redraftRosterPlayer.findMany({
        where: { rosterId: { in: linkedIds }, droppedAt: null, sport: 'NBA' },
        select: { rosterId: true, playerId: true },
      }) : []
      const byRedraft = new Map()
      for (const row of linkedPlayers) byRedraft.set(row.rosterId, [...(byRedraft.get(row.rosterId) ?? []), row.playerId])
      const rows = teams.map((team) => {
        const league = leagueById.get(team.leagueId)
        const matches = rosterByTeam.get(`${team.leagueId}\0${team.externalId}`) ?? []
        const roster = matches.length === 1 ? matches[0] : null
        return { platform: source(league.platform), leagueId: team.leagueId,
          pointsReady: Boolean(leagueHasPointsRules(league)), rosterCount: matches.length,
          ids: roster ? roster.redraftRosterId ? byRedraft.get(roster.redraftRosterId) ?? [] : rosterIds(roster.playerData) : null,
          starterIds: roster ? starterIds(roster.playerData) : [] }
      })
      const rawIds = [...new Set(rows.flatMap((row) => row.ids ?? []))]
      const identities = []
      const sportsPlayers = []
      for (const batch of chunks(rawIds)) {
        const select = Object.fromEntries([...ALL_FIELDS, 'canonicalName', 'position'].map((field) => [field, true]))
        const found = await tx.playerIdentityMap.findMany({ where: { sport: 'NBA', OR: ALL_FIELDS.map((field) => ({ [field]: { in: batch } })) }, select })
        identities.push(...found)
        sportsPlayers.push(...await tx.sportsPlayer.findMany({
          where: { sport: 'NBA', externalId: { in: batch } }, select: { externalId: true },
        }))
      }
      const uniqueIdentities = [...new Map(identities.map((row) => [row.id, row])).values()]
      const matchedRawIds = new Set(uniqueIdentities.flatMap((identity) => ALL_FIELDS.map((field) => identity[field]).filter(Boolean)))
      const fantraxRawIds = [...new Set(rows.filter((row) => row.platform === 'fantrax').flatMap((row) => row.ids ?? []))]
      const fantraxMissing = fantraxRawIds.filter((id) => !matchedRawIds.has(id))
      const fantraxLeagueKeys = leagues.filter((league) => source(league.platform) === 'fantrax')
        .map((league) => league.platformLeagueId)
      const snapshots = fantraxLeagueKeys.length ? await tx.fantraxLeague.findMany({
        where: { OR: [{ sourceLeagueId: { in: fantraxLeagueKeys } }, { id: { in: fantraxLeagueKeys } }] },
        select: { roster: true },
      }) : []
      const metadata = new Map()
      for (const snapshot of snapshots) for (const player of Array.isArray(snapshot.roster) ? snapshot.roster : []) {
        if (!player || typeof player !== 'object' || !player.fantraxId) continue
        metadata.set(String(player.fantraxId), player)
      }
      const candidateSummary = { missing: fantraxMissing.length, noSnapshotName: 0,
        uniqueNamePositionTeam: 0, uniqueNamePositionOnly: 0, ambiguousOrNoMatch: 0, alreadyAssignedOtherFantraxId: 0 }
      if (fantraxMissing.length) {
        const registry = await tx.playerIdentityMap.findMany({ where: { sport: 'NBA' },
          select: { canonicalName: true, position: true, currentTeam: true, fantraxId: true } })
        const byName = new Map()
        for (const identity of registry) {
          const key = nameKey(identity.canonicalName)
          byName.set(key, [...(byName.get(key) ?? []), identity])
        }
        for (const id of fantraxMissing) {
          const ref = metadata.get(id)
          if (!ref?.name) { candidateSummary.noSnapshotName++; continue }
          const position = positionSet(ref.primaryPosition ?? ref.position)
          const candidates = (byName.get(nameKey(ref.name)) ?? []).filter((identity) =>
            [...positionSet(identity.position)].some((token) => position.has(token)))
          if (candidates.length !== 1) { candidateSummary.ambiguousOrNoMatch++; continue }
          if (candidates[0].fantraxId && candidates[0].fantraxId !== id) {
            candidateSummary.alreadyAssignedOtherFantraxId++
            continue
          }
          const team = String(ref.team ?? '').trim().toUpperCase()
          if (team && team === String(candidates[0].currentTeam ?? '').trim().toUpperCase()) {
            candidateSummary.uniqueNamePositionTeam++
          } else candidateSummary.uniqueNamePositionOnly++
        }
      }
      const statIds = [...new Set(uniqueIdentities.flatMap((identity) => ALL_FIELDS.map((field) => identity[field]).filter(Boolean)))]
      const seasons = []
      for (const batch of chunks(statIds)) seasons.push(...await tx.playerSeasonStats.findMany({
        where: { sport: 'NBA', seasonType: 'regular', playerId: { in: batch }, gamesPlayed: { gt: 0 } },
        select: { playerId: true }, distinct: ['playerId'],
      }))
      return { leagues: leagues.length, leagueInventory, rosterRows: rosters.length, uniqueRosterPlayerIds: rawIds.length,
        fantraxMissingCandidateSummary: candidateSummary,
        report: summarize(rows, uniqueIdentities, seasons, sportsPlayers) }
    }, { timeout: 180000, maxWait: 10000 })
    console.log(JSON.stringify({ target: target.label, readOnly: true, measuredAt: new Date().toISOString(),
      note: 'seasonMissing counts regular-season rows with games played; custom-rule stat completeness is not included.',
      ...result }, null, 2))
  } finally { await db.$disconnect() }
}

if (require.main === module) main().catch((error) => {
  console.error(JSON.stringify({ failed: true, code: error.code || error.name || 'AUDIT_FAILED' }))
  process.exitCode = 1
})

module.exports = { sourceTeamId, rosterIds, summarize, leagueHasPointsRules }
