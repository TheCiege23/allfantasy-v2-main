/** Railway Function source. Separate capture, data and score services; no interval or server.
 * Stops provider work after the reviewed expiry. Deploy this exact file as a Bun Function.
 * CRON_SECRET is a same-project reference to pirate-web, never copied through output.
 */
const env = (globalThis as unknown as { Bun: { env: Record<string, string | undefined> } }).Bun.env
const base = 'https://pirate-web-staging.up.railway.app'
const until = Date.parse(env.PIRATE_REHEARSAL_UNTIL || '')
if (env.RAILWAY_PROJECT_ID !== '80e84d3b-778a-4fe6-be53-6c16068e8aa2' ||
    env.RAILWAY_ENVIRONMENT_ID !== '686eb5e0-af93-4370-806a-af544049ea93' ||
    !Number.isFinite(until) || until > Date.parse('2026-11-07T12:00:00Z') || !env.CRON_SECRET ||
    !['capture', 'data', 'score', 'daily-capture', 'daily-data'].includes(env.PIRATE_REHEARSAL_TASK || '')) {
  throw new Error('Isolated staging rehearsal configuration required')
}
if (Date.now() >= until) {
  console.log(JSON.stringify({ ok: true, stopped: 'rehearsal expired', checkedAt: new Date().toISOString() }))
} else {
  async function call(path: string, timeoutMs: number) {
    if (Date.now() >= until) return true
    try {
      const response = await fetch(`${base}${path}`, { redirect: 'error',
        headers: { authorization: `Bearer ${env.CRON_SECRET}` }, signal: AbortSignal.timeout(timeoutMs) })
      const body = await response.json() as { ok?: boolean; pilot?: string; lineupCoverageCertified?: boolean; captured?: number; scoresUpserted?: number; finalized?: number; synced?: number; claimsCreated?: number }
      const isInjury = path.startsWith('/api/cron/import-injuries?')
      const isDaily = path.includes('&pilot=daily')
      const result = { task: path.split('?')[0], sport: new URL(`${base}${path}`).searchParams.get('sport'),
        mode: new URL(`${base}${path}`).searchParams.get('task'), pilot: body.pilot,
        ok: response.ok && body.ok === true && (!isInjury || body.lineupCoverageCertified === true) && (!isDaily || body.pilot === 'daily'), httpStatus: response.status,
        lineupCoverageCertified: body.lineupCoverageCertified,
        captured: body.captured, scoresUpserted: body.scoresUpserted, finalized: body.finalized, synced: body.synced, claimsCreated: body.claimsCreated }
      console.log(JSON.stringify(result))
      return result.ok
    } catch {
      console.log(JSON.stringify({ task: path.split('?')[0], ok: false, error: 'Request failed; sensitive diagnostics omitted' }))
      return false
    }
  }
  const results: boolean[] = []
  const daily = env.PIRATE_REHEARSAL_TASK?.startsWith('daily-') === true
  results.push(await call(`/api/cron/pirate-rehearsal?task=${env.PIRATE_REHEARSAL_TASK === 'score' ? 'score' : 'capture'}${daily ? '&pilot=daily' : ''}`, env.PIRATE_REHEARSAL_TASK === 'score' ? 270000 : 60000))
  if (env.PIRATE_REHEARSAL_TASK === 'daily-data' && results[0]) {
    results.push(await call('/api/cron/pirate-rehearsal?task=data&pilot=daily', 270000))
    if (results.at(-1)) results.push(await call('/api/cron/pirate-rehearsal?task=score&pilot=daily', 270000))
  }
  // The gate above must succeed before spending provider allowance. Feed latency
  // cannot hold up the independent five-minute capture worker.
  if (env.PIRATE_REHEARSAL_TASK === 'data' && results[0]) {
    const injuries = await Promise.allSettled(['NFL', 'NBA', 'MLB', 'NHL'].map(sport =>
      call(`/api/cron/import-injuries?sport=${sport}&notifications=0`, 270000)))
    for (const outcome of injuries) results.push(outcome.status === 'fulfilled' && outcome.value)
    results.push(await call('/api/cron/pirate-rehearsal?task=schedules', 270000))
    results.push(await call('/api/cron/import-scores?sport=NFL&season=2026&notifications=0', 150000))
  }
  if (results.some(ok => !ok)) throw new Error('One or more staging rehearsal tasks failed')
}
export {}
