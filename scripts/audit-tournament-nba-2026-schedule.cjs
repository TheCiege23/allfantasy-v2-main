/** One bounded read-only provider probe. Never print credentials or raw game rows. */
const { createHash } = require('node:crypto')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

async function main() {
  const token = process.env.ROLLING_INSIGHTS_RSC_TOKEN2 || process.env.ROLLING_INSIGHTS_RSC_TOKEN
  if (!token) throw new Error('Rolling Insights NBA credential unavailable')
  const base = (process.env.ROLLING_INSIGHTS_REST_BASE_URL || 'https://rest.datafeeds.rolling-insights.com/api/v1').split(',')[0].trim().replace(/\/+$/, '')
  const prefix = /\/api\/v\d+$/.test(base) ? base : `${base}/api/v1`
  const url = new URL(`${prefix}/schedule-season/2026/NBA`)
  url.searchParams.set('RSC_token', token)
  url.searchParams.set('_', String(Date.now()))
  const response = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' }, cache: 'no-store', signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`NBA schedule unavailable (${response.status})`)
  const body = await response.json()
  const rows = body?.data?.NBA
  if (!Array.isArray(rows) || rows.length < 1000 || rows.length > 1300) throw new Error('NBA schedule shape or coverage is unexpected')
  const payload = JSON.stringify({ checkedAt: new Date().toISOString(), source: 'rolling_insights_schedule_season_2026_NBA', rows })
  const credentials = [process.env.ROLLING_INSIGHTS_RSC_TOKEN, process.env.ROLLING_INSIGHTS_RSC_TOKEN2, process.env.RSC_TOKEN].filter(Boolean)
  if (credentials.some(secret => payload.includes(secret))) throw new Error('Credential found in schedule payload')
  const folder = join(process.cwd(), 'artifacts', 'tournament-provider-samples')
  mkdirSync(folder, { recursive: true })
  const path = join(folder, 'rolling-insights-schedule-2026-NBA.json')
  writeFileSync(path, payload, { flag: 'wx' })
  const byType = {}
  for (const row of rows) byType[String(row.season_type ?? 'missing')] = (byType[String(row.season_type ?? 'missing')] ?? 0) + 1
  const times = rows.map(row => Date.parse(String(row.game_time ?? ''))).filter(Number.isFinite).sort((a, b) => a - b)
  process.stdout.write(JSON.stringify({ checkedAt: JSON.parse(payload).checkedAt, rows: rows.length, byType, timedRows: times.length, firstUtc: new Date(times[0]).toISOString(), lastUtc: new Date(times.at(-1)).toISOString(), sha256: createHash('sha256').update(payload).digest('hex'), saved: true }) + '\n')
}
main().catch(error => { process.stderr.write(`NBA schedule probe failed: ${error.message}\n`); process.exitCode = 1 })
