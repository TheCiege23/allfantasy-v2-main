import test from 'node:test'
import assert from 'node:assert/strict'
import { readConfig, scheduleJobs, profileJobs, summarizeResult, runImports, STAGING_PROJECT, STAGING_ORIGIN } from './zombie-staging-cron.mjs'

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
