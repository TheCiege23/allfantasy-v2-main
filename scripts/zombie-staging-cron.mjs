import { pathToFileURL } from 'node:url'

export const STAGING_PROJECT = '2fa5548e-62f6-467d-9a63-6e6773c62f8a'
export const STAGING_ORIGIN = 'https://zombie-web-staging.up.railway.app'
export const SPORTS = ['NFL', 'NBA', 'NHL', 'MLB']

export function readConfig(env) {
  if (env.RAILWAY_PROJECT_ID !== STAGING_PROJECT || env.RAILWAY_ENVIRONMENT_NAME !== 'staging') {
    throw new Error('staging_project_required')
  }
  if (env.ZOMBIE_STAGING_BASE_URL !== STAGING_ORIGIN) throw new Error('staging_origin_required')
  if (typeof env.ZOMBIE_CRON_SECRET !== 'string' || env.ZOMBIE_CRON_SECRET.length < 32) {
    throw new Error('cron_secret_required')
  }
  const season = Number(env.ZOMBIE_STAGING_SEASON)
  if (!Number.isInteger(season) || season < 2020 || season > 2100) throw new Error('season_required')
  const mode = env.ZOMBIE_STAGING_IMPORT_MODE ?? 'schedules'
  if (!['schedules', 'profiles', 'photos', 'profiles-and-photos', 'player-quality'].includes(mode)) throw new Error('import_mode_invalid')
  return { baseUrl: STAGING_ORIGIN, secret: env.ZOMBIE_CRON_SECRET, season, mode }
}

export function scheduleJobs(season) {
  return [
    ...SPORTS.map((sport) => ({
      name: 'schedule_' + sport, sport, kind: 'tsdb',
      path: '/api/cron/import-schedules?source=tsdb-only&tsdbSports=' + sport,
    })),
    {
      name: 'schedule_NFL_api_sports', sport: 'NFL', kind: 'api_sports',
      path: '/api/cron/import-schedules?source=api_sports&sport=NFL&tsdb=0&season=' + season,
    },
  ]
}

export function profileJobs() {
  return SPORTS.map((sport) => ({
    name: 'players_' + sport, sport, kind: 'ri_profiles',
    path: '/api/cron/import-schedules?riProfiles=1&sport=' + sport,
  }))
}

export function photoJobs() {
  return ['NBA', 'NHL', 'MLB', 'NFL'].map((sport) => ({
    name: 'photos_' + sport, sport, kind: 'photos',
    path: '/api/cron/sync-player-images?scope=players&limit=100&backfill=1&sport=' + sport,
  }))
}

export function qualityJobs(season) {
  return [
    ...profileJobs(),
    ...[1, 2, 3].map(pass => ({ name: 'sleeper_rows_NFL_' + pass, sport: 'NFL', kind: 'sleeper_rows', path: '/api/cron/import-players?sleeperRows=1&sport=NFL' })),
    ...SPORTS.map(sport => ({ name: 'rosters_' + sport, sport, kind: 'rosters', path: '/api/cron/import-schedules?rosters=1&rosterSports=' + sport })),
    ...SPORTS.flatMap(sport => [season, season - 1].map(year => ({
      name: 'stats_' + sport + '_' + year, sport, kind: 'season_stats',
      path: sport === 'NFL' ? '/api/cron/import-season-stats?season=' + year + '&tsdb=0'
        : '/api/cron/import-stat-lines?sport=' + sport + '&season=' + year,
    }))),
    ...photoJobs(),
    { name: 'market_adp_four_sports', sport: 'NFL', kind: 'market_adp', path: '/api/cron/adp-refresh?sport=NFL,NBA,NHL,MLB' },
  ]
}

/** Read only known count/flag fields. Provider errors can contain credential-bearing URLs. */
export function summarizeResult(body, job) {
  if (body?.deferredForBudget) return { status: 'partial', rows: 0 }
  if (body?.ok !== true) return { status: 'failed', rows: 0 }
  if (job.kind === 'market_adp') {
    const reads = body.providerRowsReadBySport
    if (!reads || !SPORTS.every(sport => Number.isInteger(reads[sport]) && reads[sport] > 0)) return { status: 'failed', rows: 0 }
    return { status: 'success', rows: SPORTS.reduce((sum, sport) => sum + reads[sport], 0) }
  }
  if (job.kind === 'sleeper_rows') {
    const row = body.sleeperRows
    if (!row || row.feedUnavailable || !Number.isInteger(row.updated) || !Number.isInteger(row.created)) return { status: 'failed', rows: 0 }
    return { status: 'success', rows: row.updated + row.created }
  }
  if (job.kind === 'rosters') {
    const row = body.results?.thesportsdb_rosters?.[job.sport]
    if (!row || row.error || !Number.isInteger(row.players) || row.players < 0) return { status: 'failed', rows: 0 }
    return { status: row.deferredTeams > 0 ? 'partial' : row.players > 0 ? 'success' : 'empty', rows: row.players, deferredTeams: Number(row.deferredTeams) || 0 }
  }
  if (job.kind === 'season_stats') {
    if (!Number.isInteger(body.written) || body.written < 0 || (Array.isArray(body.errors) && body.errors.length) || body.identityBackfill?.errors?.length) return { status: 'failed', rows: 0 }
    return { status: body.written > 0 ? 'success' : 'empty', rows: body.written,
      unresolved: Number(body.unresolved) || 0 }
  }
  if (job.kind === 'photos') {
    const row = body.bySport?.find((item) => item?.sport === job.sport)
    if (!row || body.dryRun || !body.ran?.includes(job.sport)) return { status: 'failed', rows: 0 }
    const passes = [row.players?.fill, row.players?.refresh]
    if (passes.some((pass) => !pass || !Number.isInteger(pass.resolved) || pass.resolved < 0)) {
      return { status: 'failed', rows: 0 }
    }
    const rows = passes.reduce((sum, pass) => sum + pass.resolved, 0)
    const partial = passes.some((pass) => pass.timedOut)
    // A fully populated pool can resolve zero new images. Lookup misses remain visible.
    return { status: partial ? 'partial' : 'success', rows,
      unresolved: passes.reduce((sum, pass) => sum + (Number(pass.failed) || 0), 0) }
  }
  if (job.kind === 'ri_profiles') {
    const profiles = body.results?.rolling_insights_profiles
    const row = profiles?.[job.sport]
    if (!row || typeof row !== 'object' || row.error) return { status: 'failed', rows: 0 }
    const rows = row.players
    if (!Number.isInteger(rows) || rows < 0) return { status: 'failed', rows: 0 }
    if (row.errors != null && (!Array.isArray(row.errors) || row.errors.length > 0)) {
      return { status: 'failed', rows }
    }
    if (row.playersDeferredForBudget || row.deferred ||
        (Array.isArray(row.deferredLeagues) && row.deferredLeagues.length > 0) ||
        (Array.isArray(profiles.deferredSports) && profiles.deferredSports.includes(job.sport))) {
      return { status: 'partial', rows }
    }
    // notModified is combined across teams AND players by this route. It cannot prove
    // that a zero-player response has an existing usable pool; keep it visible as empty.
    return { status: rows > 0 ? 'success' : 'empty', rows }
  }
  const row = job.kind === 'tsdb'
    ? body.results?.thesportsdb?.[job.sport]
    : body.results?.['api_sports_' + job.sport]
  if (!row || typeof row !== 'object' || row.error) return { status: 'failed', rows: 0 }
  const rows = Number(job.kind === 'tsdb' ? row.games : row.synced)
  if (!Number.isFinite(rows) || rows < 0) return { status: 'failed', rows: 0 }
  if (Number(row.deferredEvents ?? 0) > 0) return { status: 'partial', rows }
  return { status: rows > 0 ? 'success' : 'empty', rows }
}

export async function runImports(config, fetchImpl = fetch, log = console.log) {
  const results = []
  const jobs = config.mode === 'player-quality' ? qualityJobs(config.season) : config.mode === 'profiles-and-photos' ? [...profileJobs(), ...photoJobs()]
    : config.mode === 'profiles' ? profileJobs() : config.mode === 'photos' ? photoJobs() : scheduleJobs(config.season)
  for (const job of jobs) {
    const started = Date.now()
    let result
    try {
      const response = await fetchImpl(new URL(job.path, config.baseUrl), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + config.secret },
        redirect: 'error',
        signal: AbortSignal.timeout(290_000),
      })
      if (!response.ok) {
        await response.body?.cancel()
        result = { status: 'failed', rows: 0, httpStatus: response.status }
      } else {
        result = summarizeResult(await response.json(), job)
      }
    } catch {
      result = { status: 'failed', rows: 0, transportFailure: true }
    }
    const safe = { message: job.name + ': ' + result.status + ' (' + result.rows + ' rows)', job: job.name, ...result, durationMs: Date.now() - started }
    results.push(safe)
    log(JSON.stringify(safe))
  }
  return results
}

export async function main(env = process.env) {
  if (env.ZOMBIE_STAGING_CRON_ENABLED !== '1') {
    console.log(JSON.stringify({ status: 'disabled' }))
    return
  }
  const config = readConfig(env)
  const results = await runImports(config)
  if (results.some((result) => result.status !== 'success')) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error(JSON.stringify({ status: 'failed', reason: 'staging_configuration_invalid' }))
    process.exitCode = 1
  })
}
