/** One-time, server-side tournament evidence probe. Run with Node --env-file; never log credentials or raw rows. */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type GameRow = Record<string, unknown>
const pause = () => new Promise(done => setTimeout(done, 6000))

/** Standalone probe transport: runtime's `server-only` adapter cannot load in Node CLI. */
async function fetchRows(sport: string, date: string): Promise<{ rows: GameRow[]; credential: string }> {
  const primary = process.env.ROLLING_INSIGHTS_RSC_TOKEN || process.env.RSC_TOKEN || process.env.ROLLING_INSIGHTS_CLIENT_SECRET || process.env.ROLLING_INSIGHTS_API_KEY || process.env.ROLLING_INSIGHTS_KEY
  const secondary = process.env.ROLLING_INSIGHTS_RSC_TOKEN2 || process.env.ROLLING_INSIGHTS_CLIENT_SECRET2
  const credentials = (sport === 'NFL' ? [['primary', primary], ['secondary', secondary]] : [['secondary', secondary], ['primary', primary]])
    .filter((entry): entry is string[] => Boolean(entry[1]))
  if (!credentials.length) throw new Error('No Rolling Insights credential is configured.')
  const base = (process.env.ROLLING_INSIGHTS_REST_BASE_URL || process.env.ROLLING_INSIGHTS_REST_BASE ||
    process.env.ROLLING_INSIGHTS_BASE_URL || 'https://rest.datafeeds.rolling-insights.com/api/v1').split(',')[0]!.trim().replace(/\/+$/, '')
  const prefix = /\/api\/v\d+$/.test(base) ? base : `${base}/api/v1`
  let attemptNumber = 0
  for (const [label, token] of credentials) {
    for (let retry = 0; retry < 2; retry++) {
      if (attemptNumber++) await pause()
      const url = new URL(`${prefix}/live/${date}/${sport}`)
      url.searchParams.set('RSC_token', token!)
      url.searchParams.set('_', String(Date.now()))
      const response = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' }, cache: 'no-store', signal: AbortSignal.timeout(15000) })
      if (response.status === 304) continue
      if (!response.ok) break
      const payload = await response.json() as { data?: Record<string, unknown> }
      const rows = payload.data?.[sport]
      if (!Array.isArray(rows)) throw new Error('Provider envelope is malformed.')
      return { rows: rows as GameRow[], credential: label! }
    }
  }
  throw new Error('Provider did not return an entitled fresh JSON response.')
}

const [sport, date, mode] = process.argv.slice(2)
if (!['NBA', 'NFL'].includes(sport ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || (mode && mode !== '--refresh')) {
  process.stderr.write('Usage: audit-tournament-outcomes.ts NBA|NFL YYYY-MM-DD [--refresh]\n')
  process.exitCode = 2
} else {
  void capture(sport!, date!)
}

async function capture(sport: string, date: string) {
  try {
    const feed = await fetchRows(sport, date)
    const rows = feed.rows.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object' && !Array.isArray(row)))
    if (rows.length !== feed.rows.length) throw new Error('Provider returned malformed game rows.')
    const finalRows = rows.filter(row => /^(final|completed|complete)$/i.test(String(row.status ?? row.game_status ?? '')))
    const suggestive = finalRows.filter(row => /\b(?:DNP|INACT|inactive|did not play)\b/i.test(JSON.stringify(row.player_box ?? {})))
    const zeroStat = finalRows.filter(row => {
      const box = row.player_box as Record<string, Record<string, Record<string, unknown>>> | undefined
      return ['away_team', 'home_team'].some(side => Object.values(box?.[side] ?? {}).some(line => {
        const numeric = Object.entries(line).filter(([key, value]) => typeof value === 'number' &&
          !/^(minutes|two_point_percentage|DK_fantasy_points)$/.test(key))
        return numeric.length > 0 && numeric.every(([, value]) => value === 0)
      }))
    })
    const selected = [...new Set([...suggestive.slice(0, 1), ...zeroStat.slice(0, 1), ...finalRows.slice(0, 1)])].slice(0, 3)
    const capturedAt = new Date().toISOString()
    const sample = { sport, date, capturedAt, provider: 'rolling_insights',
      caveat: 'Sampled payload only. Absence, DNP and correction semantics remain unverified.', rows: selected }
    const serialized = JSON.stringify(sample, null, 2) + '\n'
    const tokens = [process.env.ROLLING_INSIGHTS_RSC_TOKEN, process.env.ROLLING_INSIGHTS_RSC_TOKEN2,
      process.env.ROLLING_INSIGHTS_CLIENT_SECRET, process.env.ROLLING_INSIGHTS_CLIENT_SECRET2, process.env.RSC_TOKEN,
      process.env.ROLLING_INSIGHTS_API_KEY, process.env.ROLLING_INSIGHTS_KEY,
      process.env.ROLLING_INSIGHTS_CLIENT_ID, process.env.ROLLING_INSIGHTS_CLIENT_ID2]
      .filter((value): value is string => Boolean(value && value.length > 8))
    if (tokens.some(token => serialized.includes(token))) throw new Error('Capture contains a credential and was refused.')
    const targetDir = resolve('artifacts/tournament-provider-samples')
    await mkdir(targetDir, { recursive: true })
    const path = resolve(targetDir, `rolling-insights-live-${sport}-${date}${mode === '--refresh' ? '-refresh' : ''}.json`)
    await writeFile(path, serialized, { flag: 'wx' })
    const hash = createHash('sha256').update(serialized).digest('hex')
    process.stdout.write(JSON.stringify({ sport, date, capturedAt, credential: feed.credential ?? 'unknown',
      gameRows: rows.length, finalRows: finalRows.length, suggestiveDnpOrInactiveRows: suggestive.length,
      zeroStatRows: zeroStat.length, capturedRows: selected.length, sampleSha256: hash, path }) + '\n')
  } catch {
    process.stderr.write('Tournament provider capture failed; no raw response or credential was printed.\n')
    process.exitCode = 1
  }
}
