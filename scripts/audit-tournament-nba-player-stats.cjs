/** Bounded read-only NBA player stats probe. Prints field names and counts only. */
const { createHash } = require('node:crypto')
const { mkdirSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

async function main() {
  const season = process.argv[2]
  if (!['2025', '2026'].includes(season)) throw new Error('Use the 2025 or 2026 NBA season')
  const token = process.env.ROLLING_INSIGHTS_RSC_TOKEN2 || process.env.ROLLING_INSIGHTS_RSC_TOKEN
  if (!token) throw new Error('Rolling Insights NBA credential unavailable')
  const base = (process.env.ROLLING_INSIGHTS_REST_BASE_URL || 'https://rest.datafeeds.rolling-insights.com/api/v1').split(',')[0].trim().replace(/\/+$/, '')
  const prefix = /\/api\/v\d+$/.test(base) ? base : `${base}/api/v1`
  const url = new URL(`${prefix}/player-stats/${season}/NBA`)
  url.searchParams.set('RSC_token', token)
  url.searchParams.set('_', String(Date.now()))
  const response = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' }, cache: 'no-store', signal: AbortSignal.timeout(25000) })
  if (!response.ok) throw new Error(`NBA player stats unavailable (${response.status})`)
  const body = await response.json()
  const rows = body?.data?.NBA
  if (!Array.isArray(rows) || rows.length > 5000) throw new Error('NBA player stats shape or coverage is unexpected')
  const payload = JSON.stringify({ checkedAt: new Date().toISOString(), source: `rolling_insights_player_stats_${season}_NBA`, rows })
  const credentials = [process.env.ROLLING_INSIGHTS_RSC_TOKEN, process.env.ROLLING_INSIGHTS_RSC_TOKEN2, process.env.RSC_TOKEN].filter(Boolean)
  if (credentials.some(secret => payload.includes(secret))) throw new Error('Credential found in player stats payload')
  const folder = join(process.cwd(), 'artifacts', 'tournament-provider-samples')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, `rolling-insights-player-stats-${season}-NBA.json`), payload, { flag: 'wx' })
  process.stdout.write(JSON.stringify({ season, rows: rows.length, firstRowKeys: Object.keys(rows[0] ?? {}).slice(0, 60), sha256: createHash('sha256').update(payload).digest('hex'), saved: true }) + '\n')
}
main().catch(error => { process.stderr.write(`NBA player stats probe failed: ${error.message}\n`); process.exitCode = 1 })
