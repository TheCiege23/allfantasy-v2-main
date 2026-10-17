import dotenv from 'dotenv'
import { Client } from 'pg'
import { randomUUID } from 'crypto'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const arg = String(process.argv[2] || '').trim().toUpperCase()
const aliases = {
  NCAAB: 'NCAABB',
  EUROSOCCER: 'SOCCER',
  SOCCER_EURO: 'SOCCER',
  EURO_SOCCER: 'SOCCER',
}
const normalizedArg = aliases[arg] || arg
const RI_TO_DB = {
  NBA: 'NBA',
  MLB: 'MLB',
  NHL: 'NHL',
  NCAAFB: 'NCAAF',
  NCAABB: 'NCAAB',
  SOCCER: 'SOCCER',
}
const RI_CODE_BY_SPORT = {
  SOCCER: 'EPL',
}

if (!RI_TO_DB[normalizedArg]) {
  console.error('Usage: node scripts/force-ri-sport-ingest-pg.mjs <NBA|MLB|NHL|NCAAFB|NCAABB|SOCCER>')
  process.exit(1)
}

const sportRi = RI_CODE_BY_SPORT[normalizedArg] || normalizedArg
const sportDb = RI_TO_DB[normalizedArg]

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
  console.error('Missing DATABASE_URL')
  process.exit(1)
}

const restBaseRaw = process.env.ROLLING_INSIGHTS_REST_BASE || process.env.ROLLING_INSIGHTS_REST_BASE_URL || 'https://rest.datafeeds.rolling-insights.com'
const restBase = `${String(restBaseRaw).replace(/\/+$/, '')}/api/v1`.replace(/\/api\/v1\/api\/v1$/, '/api/v1')
const rscToken = process.env.ROLLING_INSIGHTS_CLIENT_SECRET2 || process.env.ROLLING_INSIGHTS_RSC_TOKEN2 || process.env.ROLLING_INSIGHTS_RSC_TOKEN || ''

if (!rscToken) {
  console.error('Missing RI token (ROLLING_INSIGHTS_CLIENT_SECRET2/ROLLING_INSIGHTS_RSC_TOKEN2)')
  process.exit(1)
}

const now = new Date()
const localIsoDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const yesterday = new Date(now.getTime() - 86400000)
const yesterdayIso = new Date(yesterday.getTime() - yesterday.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
const currentYear = String(now.getUTCFullYear())
const previousYear = String(now.getUTCFullYear() - 1)

function plusHours(hours) {
  return new Date(Date.now() + hours * 3600000)
}

function normalizeStatus(value) {
  const s = String(value ?? '').trim().toLowerCase()
  return s || null
}

function asNullableString(value) {
  if (value == null) return null
  const s = String(value).trim()
  return s.length ? s : null
}

async function fetchRi(path) {
  const url = `${restBase}${path}${path.includes('?') ? '&' : '?'}RSC_token=${encodeURIComponent(rscToken)}`
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
  const text = await res.text()

  if (res.status === 304) {
    return { ok: true, status: 304, data: null, message: 'Not modified' }
  }

  if (!res.ok) {
    return { ok: false, status: res.status, data: null, message: text.slice(0, 220) }
  }

  try {
    const json = JSON.parse(text)
    return { ok: true, status: res.status, data: json, message: '' }
  } catch {
    return { ok: false, status: res.status, data: null, message: 'Invalid JSON response' }
  }
}

function extractArrayEnvelope(json, key) {
  const arr = json?.data?.[key]
  return Array.isArray(arr) ? arr : []
}

async function getCounts(client) {
  const teams = await client.query('select count(*)::int as c from "SportsTeam" where "sport"=$1', [sportDb])
  const players = await client.query('select count(*)::int as c from "SportsPlayer" where "sport"=$1', [sportDb])
  const injuries = await client.query('select count(*)::int as c from "SportsInjury" where "sport"=$1', [sportDb])
  const games = await client.query('select count(*)::int as c from "SportsGame" where "sport"=$1', [sportDb])
  const depthCharts = await client.query('select count(*)::int as c from depth_charts where "sport"=$1', [sportDb])

  return {
    teams: teams.rows[0].c,
    players: players.rows[0].c,
    injuries: injuries.rows[0].c,
    games: games.rows[0].c,
    depthCharts: depthCharts.rows[0].c,
  }
}

async function upsertTeams(client, rows) {
  let written = 0
  for (const row of rows) {
    const externalId = asNullableString(row.team_id) || asNullableString(row.id)
    const name = asNullableString(row.team)
    if (!externalId || !name) continue

    await client.query(
      `insert into "SportsTeam" ("id","sport","externalId","name","shortName","city","conference","division","logo","primaryColor","source","fetchedAt","expiresAt","createdAt","updatedAt")
       values ($1,$2,$3,$4,$5,null,$6,$7,$8,null,'rolling_insights',now(),$9,now(),now())
       on conflict ("sport","externalId","source")
       do update set
         "name"=excluded."name",
         "shortName"=excluded."shortName",
         "conference"=excluded."conference",
         "division"=excluded."division",
         "logo"=coalesce(excluded."logo", "SportsTeam"."logo"),
         "fetchedAt"=now(),
         "expiresAt"=excluded."expiresAt",
         "updatedAt"=now()`,
      [
        randomUUID(),
        sportDb,
        externalId,
        name,
        asNullableString(row.abbrv),
        asNullableString(row.conf),
        asNullableString(row.div),
        asNullableString(row.img),
        plusHours(24),
      ]
    )
    written += 1
  }
  return written
}

async function upsertPlayers(client, rows) {
  let written = 0
  for (const row of rows) {
    const externalId = asNullableString(row.player_id) || asNullableString(row.id)
    const name = asNullableString(row.player)
    if (!externalId || !name) continue

    await client.query(
      `insert into "SportsPlayer" ("id","sport","externalId","name","position","team","teamId","number","age","height","weight","college","imageUrl","sleeperId","dob","status","source","fetchedAt","expiresAt","createdAt","updatedAt")
       values ($1,$2,$3,$4,$5,$6,$7,$8,null,$9,$10,$11,null,null,null,$12,'rolling_insights',now(),$13,now(),now())
       on conflict ("sport","externalId","source")
       do update set
         "name"=excluded."name",
         "position"=excluded."position",
         "team"=excluded."team",
         "teamId"=excluded."teamId",
         "number"=excluded."number",
         "height"=excluded."height",
         "weight"=excluded."weight",
         "college"=excluded."college",
         "status"=excluded."status",
         "fetchedAt"=now(),
         "expiresAt"=excluded."expiresAt",
         "updatedAt"=now()`,
      [
        randomUUID(),
        sportDb,
        externalId,
        name,
        asNullableString(row.position),
        asNullableString(row.team),
        asNullableString(row.team_id),
        Number.isFinite(Number(row.number)) ? Number(row.number) : null,
        asNullableString(row.height),
        asNullableString(row.weight),
        asNullableString(row.college),
        asNullableString(row.status),
        plusHours(24),
      ]
    )
    written += 1
  }
  return written
}

async function upsertInjuries(client, teamRows) {
  let written = 0
  for (const teamRow of teamRows) {
    const teamName = asNullableString(teamRow.team)
    const teamId = asNullableString(teamRow.team_id)
    const injuries = Array.isArray(teamRow.injuries) ? teamRow.injuries : []

    for (const injury of injuries) {
      const playerName = asNullableString(injury.player)
      if (!playerName) continue

      const status = asNullableString(injury.status) || asNullableString(injury.injury) || 'unknown'
      const dateText = asNullableString(injury.return_date) || asNullableString(injury.updated_at)
      const date = dateText ? new Date(dateText) : new Date()
      const externalId = `${sportDb}:${teamId || teamName || 'TEAM'}:${playerName}:${status}:${date.toISOString().slice(0, 10)}`

      await client.query(
        `insert into "SportsInjury" ("id","sport","externalId","playerName","playerId","team","teamId","position","type","status","description","date","season","week","source","fetchedAt","expiresAt","createdAt","updatedAt","raw")
         values ($1,$2,$3,$4,null,$5,$6,null,$7,$8,$9,$10,null,null,'rolling_insights',now(),$11,now(),now(),$12::jsonb)
         on conflict ("sport","externalId","source")
         do update set
           "playerName"=excluded."playerName",
           "team"=excluded."team",
           "teamId"=excluded."teamId",
           "type"=excluded."type",
           "status"=excluded."status",
           "description"=excluded."description",
           "date"=excluded."date",
           "fetchedAt"=now(),
           "expiresAt"=excluded."expiresAt",
           "updatedAt"=now(),
           "raw"=excluded."raw"`,
        [
          randomUUID(),
          sportDb,
          externalId,
          playerName,
          teamName,
          teamId,
          asNullableString(injury.injury),
          status,
          asNullableString(injury.details) || asNullableString(injury.notes),
          Number.isNaN(date.getTime()) ? new Date() : date,
          plusHours(12),
          JSON.stringify(injury),
        ]
      )
      written += 1
    }
  }
  return written
}

async function upsertGames(client, rows) {
  let written = 0
  for (const row of rows) {
    const externalId = asNullableString(row.game_ID) || asNullableString(row.gameId)
    const homeTeam = asNullableString(row.home_team) || asNullableString(row.homeTeamName)
    const awayTeam = asNullableString(row.away_team) || asNullableString(row.awayTeamName)
    if (!externalId || !homeTeam || !awayTeam) continue

    const dateText = asNullableString(row.date) || asNullableString(row.game_time)
    const startTime = dateText ? new Date(dateText) : null

    await client.query(
      `insert into "SportsGame" ("id","sport","externalId","homeTeam","homeTeamId","awayTeam","awayTeamId","homeScore","awayScore","status","startTime","venue","week","season","source","fetchedAt","expiresAt","createdAt","updatedAt","raw")
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,null,$13,'rolling_insights',now(),$14,now(),now(),$15::jsonb)
       on conflict ("sport","externalId","source")
       do update set
         "homeTeam"=excluded."homeTeam",
         "homeTeamId"=excluded."homeTeamId",
         "awayTeam"=excluded."awayTeam",
         "awayTeamId"=excluded."awayTeamId",
         "homeScore"=excluded."homeScore",
         "awayScore"=excluded."awayScore",
         "status"=excluded."status",
         "startTime"=excluded."startTime",
         "venue"=excluded."venue",
         "season"=excluded."season",
         "fetchedAt"=now(),
         "expiresAt"=excluded."expiresAt",
         "updatedAt"=now(),
         "raw"=excluded."raw"`,
      [
        randomUUID(),
        sportDb,
        externalId,
        homeTeam,
        asNullableString(row.home_team_ID),
        awayTeam,
        asNullableString(row.away_team_ID),
        Number.isFinite(Number(row.home_score)) ? Number(row.home_score) : null,
        Number.isFinite(Number(row.away_score)) ? Number(row.away_score) : null,
        normalizeStatus(row.status),
        startTime && !Number.isNaN(startTime.getTime()) ? startTime : null,
        asNullableString(row.arena) || asNullableString(row.location) || asNullableString(row.city),
        Number.isFinite(Number(row.season?.slice?.(0, 4))) ? Number(row.season.slice(0, 4)) : Number.isFinite(Number(row.season)) ? Number(row.season) : null,
        plusHours(12),
        JSON.stringify(row),
      ]
    )
    written += 1
  }
  return written
}

async function upsertDepthCharts(client, payload) {
  const bucket = payload?.data?.[sportRi]
  if (!bucket || typeof bucket !== 'object') return 0

  let written = 0
  for (const [team, positions] of Object.entries(bucket)) {
    if (!positions || typeof positions !== 'object') continue

    for (const [position, slotMap] of Object.entries(positions)) {
      if (!slotMap || typeof slotMap !== 'object') continue
      const players = Object.values(slotMap)
        .map((v) => (v && typeof v === 'object' ? asNullableString(v.player) : null))
        .filter(Boolean)

      await client.query(
        `insert into depth_charts ("id","sport","team","teamId","position","players","source","season","fetchedAt","expiresAt","createdAt","updatedAt")
         values ($1,$2,$3,null,$4,$5::jsonb,'rolling_insights',$6,now(),$7,now(),now())
         on conflict ("sport","team","position","source")
         do update set
           "players"=excluded."players",
           "season"=excluded."season",
           "fetchedAt"=now(),
           "expiresAt"=excluded."expiresAt",
           "updatedAt"=now()`,
        [randomUUID(), sportDb, team, position, JSON.stringify(players), currentYear, plusHours(24)]
      )
      written += 1
    }
  }

  return written
}

async function main() {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()

  const before = await getCounts(client)
  console.log('Before:', { sport: sportDb, ...before })

  const teamInfo = await fetchRi(`/team-info/${sportRi}`)
  const playerInfo = await fetchRi(`/player-info/${sportRi}`)
  const injuries = await fetchRi(`/injuries/${sportRi}`)
  const depthCharts = await fetchRi(`/depth-charts/${sportRi}`)

  let seasonSchedule = await fetchRi(`/schedule-season/${currentYear}/${sportRi}`)
  if (!seasonSchedule.ok || (seasonSchedule.status !== 304 && extractArrayEnvelope(seasonSchedule.data, sportRi).length === 0)) {
    seasonSchedule = await fetchRi(`/schedule-season/${previousYear}/${sportRi}`)
  }

  const dailySchedule = await fetchRi(`/schedule-daily/${localIsoDate}/${sportRi}`)
  const weeklySchedule = await fetchRi(`/schedule-weekly/${localIsoDate}/${sportRi}`)
  const dailySchedulePrev = await fetchRi(`/schedule-daily/${yesterdayIso}/${sportRi}`)

  const statusSummary = {
    teamInfo: teamInfo.status,
    playerInfo: playerInfo.status,
    injuries: injuries.status,
    depthCharts: depthCharts.status,
    seasonSchedule: seasonSchedule.status,
    dailySchedule: dailySchedule.status,
    weeklySchedule: weeklySchedule.status,
    yesterdayDaily: dailySchedulePrev.status,
  }
  console.log('RI statuses:', statusSummary)

  await client.query('begin')
  try {
    const written = {
      teams: teamInfo.ok && teamInfo.data ? await upsertTeams(client, extractArrayEnvelope(teamInfo.data, sportRi)) : 0,
      players: playerInfo.ok && playerInfo.data ? await upsertPlayers(client, extractArrayEnvelope(playerInfo.data, sportRi)) : 0,
      injuries: injuries.ok && injuries.data ? await upsertInjuries(client, extractArrayEnvelope(injuries.data, sportRi)) : 0,
      depthCharts: depthCharts.ok && depthCharts.data ? await upsertDepthCharts(client, depthCharts.data) : 0,
      gamesSeason: seasonSchedule.ok && seasonSchedule.data ? await upsertGames(client, extractArrayEnvelope(seasonSchedule.data, sportRi)) : 0,
      gamesDaily: dailySchedule.ok && dailySchedule.data ? await upsertGames(client, extractArrayEnvelope(dailySchedule.data, sportRi)) : 0,
      gamesWeekly: weeklySchedule.ok && weeklySchedule.data ? await upsertGames(client, extractArrayEnvelope(weeklySchedule.data, sportRi)) : 0,
      gamesYesterday: dailySchedulePrev.ok && dailySchedulePrev.data ? await upsertGames(client, extractArrayEnvelope(dailySchedulePrev.data, sportRi)) : 0,
    }

    await client.query('commit')

    const after = await getCounts(client)
    const delta = {
      teams: after.teams - before.teams,
      players: after.players - before.players,
      injuries: after.injuries - before.injuries,
      games: after.games - before.games,
      depthCharts: after.depthCharts - before.depthCharts,
    }

    console.log('Written (attempted upserts):', written)
    console.log('After:', { sport: sportDb, ...after })
    console.log('Delta:', { sport: sportDb, ...delta })
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('[force-ri-sport-ingest-pg] failed:', error)
  process.exit(1)
})
