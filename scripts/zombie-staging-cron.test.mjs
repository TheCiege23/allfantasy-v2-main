import test from 'node:test'
import assert from 'node:assert/strict'
import { readConfig, scheduleJobs, summarizeResult, runImports, STAGING_PROJECT, STAGING_ORIGIN } from './zombie-staging-cron.mjs'

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
