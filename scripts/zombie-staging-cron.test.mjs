import test from 'node:test'
import assert from 'node:assert/strict'
import { readConfig, scheduleJobs, profileJobs, photoJobs, qualityJobs, summarizeResult, runImports, STAGING_PROJECT, STAGING_ORIGIN } from './zombie-staging-cron.mjs'

const env = {
  RAILWAY_PROJECT_ID: STAGING_PROJECT, RAILWAY_ENVIRONMENT_NAME: 'staging',
  ZOMBIE_STAGING_BASE_URL: STAGING_ORIGIN, ZOMBIE_CRON_SECRET: 'test-only-credential-'.repeat(3),
  ZOMBIE_STAGING_SEASON: '2026',
}

test('refuses another project, environment, host, redirect URL, missing secret or invalid season', () => {
  for (const change of [
    { RAILWAY_PROJECT_ID: 'production' }, { RAILWAY_ENVIRONMENT_NAME: 'production' },
    { ZOMBIE_STAGING_BASE_URL: 'https://example.com' }, { ZOMBIE_STAGING_BASE_URL: STAGING_ORIGIN + '/redirect' },
    { ZOMBIE_CRON_SECRET: '' }, { ZOMBIE_STAGING_SEASON: 'NaN' },
  ]) assert.throws(() => readConfig({ ...env, ...change }))
  assert.equal(readConfig(env).season, 2026)
})

test('scopes every schedule request to the four requested sports', () => {
  const jobs = scheduleJobs(2026)
  assert.deepEqual(jobs.filter((job) => job.kind === 'tsdb').map((job) => job.sport), ['NFL', 'NBA', 'NHL', 'MLB'])
  for (const job of jobs.filter((job) => job.kind === 'tsdb')) {
    const url = new URL(job.path, STAGING_ORIGIN)
    assert.equal(url.searchParams.get('tsdbSports'), job.sport)
    assert.equal(url.searchParams.get('source'), 'tsdb-only')
  }
})

test('HTTP 200 can still represent failure, partial work or an empty provider feed', () => {
  const job = scheduleJobs(2026)[0]
  assert.equal(summarizeResult({ ok: true, deferredForBudget: true }, job).status, 'partial')
  assert.equal(summarizeResult({ ok: true, results: { thesportsdb: { NFL: { error: 'private' } } } }, job).status, 'failed')
  assert.equal(summarizeResult({ ok: true, results: { thesportsdb: { NFL: { games: 0 } } } }, job).status, 'empty')
  assert.equal(summarizeResult({ ok: true, results: { thesportsdb: { NFL: { games: 3, deferredEvents: 2 } } } }, job).status, 'partial')
  assert.equal(summarizeResult({ ok: true, results: { thesportsdb: { NFL: { games: 3 } } } }, job).status, 'success')
})

test('continues other sports after a failure, does not follow redirects, and never logs body/credential errors', async () => {
  const calls = []
  const logs = []
  let cancelled = false
  const results = await runImports(readConfig(env), async (url, options) => {
    calls.push({ url, options })
    assert.equal(options.headers.Authorization, 'Bearer ' + env.ZOMBIE_CRON_SECRET)
    assert.equal(options.redirect, 'error')
    const sport = url.searchParams.get('tsdbSports')
    if (sport === 'NBA') return { ok: false, status: 502, body: { cancel: async () => { cancelled = true } } }
    if (sport === 'NHL') throw new Error('private ' + env.ZOMBIE_CRON_SECRET)
    return { ok: true, json: async () => sport
      ? { ok: true, results: { thesportsdb: { [sport]: { games: 10 } } }, diagnostics: env.ZOMBIE_CRON_SECRET }
      : { ok: true, results: { api_sports_NFL: { synced: 20 } } } }
  }, (line) => logs.push(line))
  assert.equal(calls.length, 5)
  assert.equal(cancelled, true)
  assert.deepEqual(results.map((r) => r.status), ['success', 'failed', 'failed', 'success', 'success'])
  assert.equal(logs.join('').includes(env.ZOMBIE_CRON_SECRET), false)
  assert.equal(logs.join('').includes('private'), false)
})

test('profile mode explicitly scopes one Rolling Insights player pass per requested sport', () => {
  assert.equal(readConfig(env).mode, 'schedules')
  assert.equal(readConfig({ ...env, ZOMBIE_STAGING_IMPORT_MODE: 'profiles' }).mode, 'profiles')
  assert.throws(() => readConfig({ ...env, ZOMBIE_STAGING_IMPORT_MODE: 'all' }))
  assert.deepEqual(profileJobs().map(job => job.sport), ['NFL', 'NBA', 'NHL', 'MLB'])
  for (const job of profileJobs()) {
    const url = new URL(job.path, STAGING_ORIGIN)
    assert.equal(url.searchParams.get('riProfiles'), '1')
    assert.equal(url.searchParams.get('sport'), job.sport)
    assert.equal(url.searchParams.size, 2)
  }
})

test('team success does not hide missing, errored, malformed or deferred player imports', () => {
  const job = profileJobs()[0]
  const body = (row, extra = {}) => ({ ok: true, results: {
    rolling_insights_profiles: { [job.sport]: row, ...extra },
  } })
  for (const row of [
    { teams: 32, players: 0 }, { teams: 32, players: 0, notModified: true },
  ]) assert.equal(summarizeResult(body(row), job).status, 'empty')
  for (const row of [
    { teams: 32 }, { players: null }, { players: '200' }, { players: -1 },
    { players: 200, errors: ['private provider URL'] }, { error: 'private' },
  ]) assert.equal(summarizeResult(body(row), job).status, 'failed')
  for (const row of [
    { players: 200, playersDeferredForBudget: true },
    { players: 200, deferredLeagues: ['all (100 players unwritten)'] },
    { players: 200, deferred: true },
  ]) assert.equal(summarizeResult(body(row), job).status, 'partial')
  assert.equal(summarizeResult(body({ players: 200 }, { deferredSports: ['NFL'] }), job).status, 'partial')
  assert.equal(summarizeResult(body({ players: 200, errors: [] }), job).status, 'success')
})

test('profile runs continue each sport and log only safe player counts even on provider errors', async () => {
  const logs = []
  const sports = []
  const results = await runImports(readConfig({ ...env, ZOMBIE_STAGING_IMPORT_MODE: 'profiles' }),
    async (url) => {
      const sport = url.searchParams.get('sport')
      sports.push(sport)
      return { ok: true, json: async () => ({ ok: true, results: {
        rolling_insights_profiles: { [sport]: {
          teams: 32, players: 100,
          ...(sport === 'NBA' ? { errors: ['private ' + env.ZOMBIE_CRON_SECRET] } : {}),
        } },
      } }) }
    }, line => logs.push(line))
  assert.deepEqual(sports, ['NFL', 'NBA', 'NHL', 'MLB'])
  assert.deepEqual(results.map(r => r.status), ['success', 'failed', 'success', 'success'])
  assert.equal(logs.join('').includes(env.ZOMBIE_CRON_SECRET), false)
  assert.equal(logs.join('').includes('private'), false)
})

test('photo jobs initialize canonical identities and stay within one requested sport', () => {
  assert.equal(readConfig({ ...env, ZOMBIE_STAGING_IMPORT_MODE: 'photos' }).mode, 'photos')
  assert.deepEqual(photoJobs().map(job => job.sport), ['NBA', 'NHL', 'MLB', 'NFL'])
  for (const job of photoJobs()) {
    const url = new URL(job.path, STAGING_ORIGIN)
    assert.equal(url.pathname, '/api/cron/sync-player-images')
    assert.equal(url.searchParams.get('sport'), job.sport)
    assert.equal(url.searchParams.get('backfill'), '1')
    assert.equal(url.searchParams.get('scope'), 'players')
    assert.equal(url.searchParams.get('limit'), '100')
  }
})

test('photo runs distinguish partial work, missing results and clean zero-write runs', () => {
  const job = photoJobs()[0]
  const body = (fill = {}, extra = {}) => ({ ok: true, ran: ['NBA'], bySport: [{
    sport: 'NBA', players: {
      fill: { resolved: 0, failed: 0, timedOut: false, ...fill },
      refresh: { resolved: 0, failed: 0, timedOut: false },
    },
  }], ...extra })
  assert.equal(summarizeResult(body(), job).status, 'success')
  assert.equal(summarizeResult(body({ resolved: 4, failed: 2 }), job).unresolved, 2)
  assert.equal(summarizeResult(body({ resolved: 4, timedOut: true }), job).status, 'partial')
  assert.equal(summarizeResult(body({}, { ran: [] }), job).status, 'failed')
  assert.equal(summarizeResult(body({}, { dryRun: true }), job).status, 'failed')
})

test('photo runs continue after failures and do not log raw provider diagnostics', async () => {
  const logs = []
  const results = await runImports(readConfig({ ...env, ZOMBIE_STAGING_IMPORT_MODE: 'photos' }),
    async url => {
      const sport = url.searchParams.get('sport')
      if (sport === 'NHL') throw new Error(env.ZOMBIE_CRON_SECRET)
      return { ok: true, json: async () => ({ ok: true, ran: [sport], bySport: [{
        sport, players: { fill: { resolved: 10, failed: 2, timedOut: false },
          refresh: { resolved: 0, failed: 0, timedOut: false } },
      }], diagnostics: env.ZOMBIE_CRON_SECRET }) }
    }, line => logs.push(line))
  assert.deepEqual(results.map(row => row.status), ['success', 'failed', 'success', 'success'])
  assert.equal(logs.join('').includes(env.ZOMBIE_CRON_SECRET), false)
})

test('combined mode refreshes profiles before photographs', async () => {
  const calls = []
  const config = readConfig({ ...env, ZOMBIE_STAGING_IMPORT_MODE: 'profiles-and-photos' })
  await runImports(config, async url => {
    calls.push(url.pathname)
    return { ok: false, status: 503 }
  }, () => {})
  assert.deepEqual(calls, [
    ...['NFL', 'NBA', 'NHL', 'MLB'].map(() => '/api/cron/import-schedules'),
    ...['NFL', 'NBA', 'NHL', 'MLB'].map(() => '/api/cron/sync-player-images'),
  ])
})

test('quality maintenance scopes roster and stats calls without changing league state', () => {
  const jobs = qualityJobs(2026)
  assert.equal(readConfig({ ...env, ZOMBIE_STAGING_IMPORT_MODE: 'player-quality' }).mode, 'player-quality')
  assert.equal(jobs.filter(j => j.kind === 'rosters').length, 4)
  assert.equal(jobs.filter(j => j.kind === 'season_stats').length, 8)
  for (const job of jobs) {
    assert.ok(['NFL', 'NBA', 'NHL', 'MLB'].includes(job.sport))
    assert.ok(job.path.startsWith('/api/cron/'))
    if (job.kind === 'rosters') assert.equal(new URL(job.path, STAGING_ORIGIN).searchParams.get('rosterSports'), job.sport)
  }
  assert.equal(summarizeResult({ ok: true, written: 5, unresolved: 1 }, jobs.find(j => j.kind === 'season_stats')).unresolved, 1)
  assert.equal(summarizeResult({ ok: true, results: { thesportsdb_rosters: { NBA: { players: 5, deferredTeams: 2 } } } }, { kind: 'rosters', sport: 'NBA' }).status, 'partial')
})

test('daily quality refresh includes one bounded four-sport ADP ingest and detects missing feeds', () => {
  const jobs = qualityJobs(2026).filter(job => job.kind === 'market_adp')
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].path, '/api/cron/adp-refresh?sport=NFL,NBA,NHL,MLB')
  const body = { ok: true, providerRowsReadBySport: { NFL: 330, NBA: 440, NHL: 880, MLB: 620 }, providerRowsWritten: 0,
    ffcByFormat: Object.fromEntries(['standard','ppr','half-ppr','2qb'].map(format => [format, { fresh: true }])) }
  assert.equal(summarizeResult(body, jobs[0]).status, 'success')
  assert.equal(summarizeResult({ ...body, providerRowsReadBySport: { ...body.providerRowsReadBySport, NHL: 0 } }, jobs[0]).status, 'failed')
  assert.equal(summarizeResult({ ok: true }, jobs[0]).status, 'failed')
})

test('old or undated NFL samples are partial even when every sport returned positive row counts', () => {
  const job = qualityJobs(2026).find(j => j.kind === 'market_adp')
  const body = { ok: true, providerRowsReadBySport: { NFL: 330, NBA: 440, NHL: 880, MLB: 620 },
    ffcByFormat: Object.fromEntries(['standard','ppr','half-ppr','2qb'].map(format => [format, { fresh: true }])) }
  body.ffcByFormat['half-ppr'] = { fresh: false }
  assert.deepEqual(summarizeResult(body, job).staleFfcFormats, ['half-ppr'])
  assert.equal(summarizeResult(body, job).status, 'partial')
  delete body.ffcByFormat
  assert.equal(summarizeResult(body, job).status, 'partial')
})
