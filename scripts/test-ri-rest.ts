// test-ri-rest.ts — untracked, do not commit
// Tests the correct RI REST player-info endpoint per NBA docs
// Run: npx tsx scripts/test-ri-rest.ts

import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const BASE = 'https://rest.datafeeds.rolling-insights.com'
/** REST RSC_token = CLIENT_SECRET2 (not CLIENT_ID2). */
const TOKEN = process.env.ROLLING_INSIGHTS_CLIENT_SECRET2 ?? ''

if (!TOKEN) {
  console.error('❌ ROLLING_INSIGHTS_CLIENT_SECRET2 is not set')
  process.exit(1)
}

console.log(`RSC (SECRET2): ${TOKEN.slice(0, 11)}... (${TOKEN.length} chars)`)

const SPORTS = ['NBA', 'NHL', 'MLB', 'SOCCER', 'PGA', 'NCAABB', 'NCAAFB']

async function testSport(sport: string) {
  const leagueParam = sport === 'SOCCER' ? '&league=EPL' : ''
  const url = `${BASE}/api/v1/player-info/${sport}?RSC_token=${TOKEN}${leagueParam}`
  console.log(`\nTesting /api/v1/player-info/${sport}${leagueParam ? ' (league=EPL)' : ''}...`)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) {
      const text = await res.text()
      console.log(`  ❌ HTTP ${res.status}: ${text.slice(0, 120)}`)
      return
    }
    const json = (await res.json()) as { data?: Record<string, unknown[]> }
    const dataKey = sport === 'SOCCER' ? 'EPL' : sport
    const players = json?.data?.[dataKey] ?? []
    console.log(`  ✅ ${dataKey} — ${players.length} records`)
    if (players.length > 0) {
      console.log(`  First player keys: ${Object.keys(players[0] as object).join(', ')}`)
      console.log(`  First player sample:`, JSON.stringify(players[0], null, 2))
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`  ❌ Network error: ${msg}`)
  }
}

async function main() {
  for (const sport of SPORTS) {
    await testSport(sport)
  }
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
