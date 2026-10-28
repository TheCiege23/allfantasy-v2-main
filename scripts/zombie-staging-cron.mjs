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
  if (!['schedules', 'profiles'].includes(mode)) throw new Error('import_mode_invalid')
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

/** Read only known count/flag fields. Provider errors can contain credential-bearing URLs. */
export function summarizeResult(body, job) {
  if (body?.deferredForBudget) return { status: 'partial', rows: 0 }
  if (body?.ok !== true) return { status: 'failed', rows: 0 }
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
  for (const job of (config.mode === 'profiles' ? profileJobs() : scheduleJobs(config.season))) {
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
