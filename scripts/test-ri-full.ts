import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

const BASE = 'https://rest.datafeeds.rolling-insights.com/api/v1'

// ── Resolve both credential sets ──────────────────────────
// Credential set 1: NFL
const TOKEN1 =
  process.env.ROLLING_INSIGHTS_RSC_TOKEN ??
  process.env.ROLLING_INSIGHTS_RSC_TOKEN1 ??
  process.env.RI_RSC_TOKEN ??
  ''

// Credential set 2: MLB, NHL, NBA, Soccer, NCAABB, NCAAFB
const TOKEN2 =
  process.env.ROLLING_INSIGHTS_RSC_TOKEN2 ??
  process.env.RI_RSC_TOKEN2 ??
  process.env.ROLLING_INSIGHTS_RSC_TOKEN_2 ??
  ''

// Sport routing
const SPORTS_TOKEN1 = ['NFL']
const SPORTS_TOKEN2 = ['MLB', 'NHL', 'NBA', 'SOCCER', 'NCAABB', 'NCAAFB']

// ── Today's date ───────────────────────────────────────────
const today = new Date()
const dateStr = today.toISOString().split('T')[0] // YYYY-MM-DD
const year = today.getFullYear()
const yesterday = new Date(today)
yesterday.setDate(yesterday.getDate() - 1)
const yday = yesterday.toISOString().split('T')[0]

// ── HTTP helper ────────────────────────────────────────────
async function get(url: string, label: string, timeoutMs = 12000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    const text = await res.text()

    let data: unknown
    let parsed = false
    try {
      data = JSON.parse(text)
      parsed = true
    } catch {
      /* not JSON */
    }

    const d = parsed && data && typeof data === 'object' ? (data as Record<string, unknown>) : null
    const arr = d
      ? Array.isArray(data)
        ? (data as unknown[])
        : Array.isArray(d.players)
          ? (d.players as unknown[])
          : Array.isArray(d.teams)
            ? (d.teams as unknown[])
            : Array.isArray(d.games)
              ? (d.games as unknown[])
              : Array.isArray(d.schedule)
                ? (d.schedule as unknown[])
                : Object.values(d)
      : []

    const status = res.ok ? '✅' : '❌'
    const count = arr.length > 0 ? ` [${arr.length} records]` : ''
    const sample = arr[0]
      ? ` sample keys: ${Object.keys(arr[0] as object).slice(0, 8).join(', ')}`
      : ''

    // Find image/headshot fields
    const imgFields = arr[0]
      ? Object.entries(arr[0] as Record<string, unknown>)
          .filter(
            ([k, v]) =>
              typeof v === 'string' &&
              (v as string).startsWith('http') &&
              /headshot|image|img|photo|logo|avatar|thumb/i.test(k)
          )
          .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
      : []

    return {
      ok: res.ok,
      status: res.status,
      count: arr.length,
      sample: arr[0],
      imgFields,
      label,
      statusIcon: status,
      summary: `${status} ${label} (${res.status})${count}${sample}`,
      imgSummary: imgFields.length ? `   🖼  ${imgFields.slice(0, 2).join(' | ')}` : '',
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      status: 0,
      count: 0,
      sample: null,
      imgFields: [] as string[],
      label,
      statusIcon: '❌',
      summary: `❌ ${label} — Network error: ${msg.slice(0, 80)}`,
      imgSummary: '',
    }
  }
}

// ── Test a sport across all endpoint types ─────────────────
async function testSport(sport: string, token: string) {
  const pad = sport.padEnd(8)
  console.log(`\n  ${'─'.repeat(52)}`)
  console.log(`  ${pad}`)
  console.log(`  ${'─'.repeat(52)}`)

  const results = await Promise.all([
    // ── PRE-GAME ──────────────────────────────────────────
    get(`${BASE}/schedule-season/${year}/${sport}?RSC_token=${token}`, `Pre-Game | Season schedule ${year}`),
    get(`${BASE}/schedule/${dateStr}/${sport}?RSC_token=${token}`, `Pre-Game | Today's schedule (${dateStr})`),
    get(`${BASE}/players/${sport}?RSC_token=${token}`, `Pre-Game | Players`),
    get(`${BASE}/teams/${sport}?RSC_token=${token}`, `Pre-Game | Teams`),
    get(`${BASE}/injuries/${sport}?RSC_token=${token}`, `Pre-Game | Injuries`),
    get(`${BASE}/depth-charts/${sport}?RSC_token=${token}`, `Pre-Game | Depth Charts`),
    get(`${BASE}/standings/${year}/${sport}?RSC_token=${token}`, `Pre-Game | Standings ${year}`),

    // ── POST-GAME ─────────────────────────────────────────
    get(`${BASE}/live/${yday}/${sport}?RSC_token=${token}`, `Post-Game | Final scores yesterday (${yday})`),
    get(`${BASE}/live/${dateStr}/${sport}?RSC_token=${token}`, `Post-Game | Scores today (${dateStr})`),

    // ── LIVE / REAL-TIME ──────────────────────────────────
    get(`${BASE}/live/${dateStr}/${sport}?RSC_token=${token}`, `Live | Live feed today`),
    get(`${BASE}/boxscore/${dateStr}/${sport}?RSC_token=${token}`, `Live | Box scores today`),

    // ── HISTORICAL ───────────────────────────────────────
    get(`${BASE}/live/2024-12-15/${sport}?RSC_token=${token}`, `Historical | Dec 15 2024 scores`),
    get(`${BASE}/schedule-season/2024/${sport}?RSC_token=${token}`, `Historical | 2024 season schedule`),
  ])

  let hasAnyData = false
  for (const r of results) {
    console.log(`  ${r.summary}`)
    if (r.imgSummary) console.log(r.imgSummary)
    if (r.ok && r.count > 0) hasAnyData = true
  }

  // Report which endpoint types work
  const preOk = results.slice(0, 7).filter((r) => r.ok && r.count > 0).length
  const postOk = results.slice(7, 9).filter((r) => r.ok && r.count > 0).length
  const liveOk = results.slice(9, 11).filter((r) => r.ok && r.count > 0).length
  const histOk = results.slice(11).filter((r) => r.ok && r.count > 0).length

  console.log(`\n  Summary for ${sport}:`)
  console.log(`    Pre-game:   ${preOk}/7 endpoints returned data`)
  console.log(`    Post-game:  ${postOk}/2 endpoints returned data`)
  console.log(`    Live:       ${liveOk}/2 endpoints returned data`)
  console.log(`    Historical: ${histOk}/2 endpoints returned data`)

  return { sport, preOk, postOk, liveOk, histOk, hasAnyData }
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  console.log('═'.repeat(60))
  console.log('  Rolling Insights — Full API Coverage Test')
  console.log(`  Date: ${dateStr}`)
  console.log('═'.repeat(60))

  if (!TOKEN1) {
    console.error('❌ TOKEN1 (NFL) not found in env!')
    console.error('   Expected: ROLLING_INSIGHTS_RSC_TOKEN or similar')
  } else {
    console.log(`✅ TOKEN1 (NFL): ${TOKEN1.slice(0, 12)}...`)
  }
  if (!TOKEN2) {
    console.error('❌ TOKEN2 (MLB/NHL/NBA/etc) not found in env!')
    console.error('   Expected: ROLLING_INSIGHTS_RSC_TOKEN2 or similar')
  } else {
    console.log(`✅ TOKEN2 (MLB/NHL/NBA/etc): ${TOKEN2.slice(0, 12)}...`)
  }

  if (!TOKEN1 && !TOKEN2) {
    console.error('\n❌ No tokens found — check your env var names')
    process.exit(1)
  }

  // ── Run TOKEN1 sports ──────────────────────────────────
  console.log('\n' + '═'.repeat(60))
  console.log('  API SET 1 — NFL')
  console.log('═'.repeat(60))
  const summaries1 = []
  for (const sport of SPORTS_TOKEN1) {
    if (TOKEN1) summaries1.push(await testSport(sport, TOKEN1))
  }

  // ── Run TOKEN2 sports ──────────────────────────────────
  console.log('\n' + '═'.repeat(60))
  console.log('  API SET 2 — MLB | NHL | NBA | SOCCER | NCAABB | NCAAFB')
  console.log('═'.repeat(60))
  const summaries2 = []
  for (const sport of SPORTS_TOKEN2) {
    const token = TOKEN2 || TOKEN1 // fallback to TOKEN1 if TOKEN2 missing
    if (token) summaries2.push(await testSport(sport, token))
  }

  // ── Final summary table ────────────────────────────────
  const allSummaries = [...summaries1, ...summaries2]
  console.log('\n' + '═'.repeat(60))
  console.log('  RESULTS SUMMARY')
  console.log('═'.repeat(60))
  console.log(`  ${'Sport'.padEnd(10)} ${'Pre'.padEnd(6)} ${'Post'.padEnd(6)} ${'Live'.padEnd(6)} ${'Hist'.padEnd(6)} Status`)
  console.log(`  ${'─'.repeat(50)}`)
  for (const s of allSummaries) {
    const status = s.hasAnyData ? '✅ Active' : '❌ No data'
    console.log(
      `  ${s.sport.padEnd(10)} ${String(s.preOk).padEnd(6)} ${String(s.postOk).padEnd(6)} ${String(s.liveOk).padEnd(6)} ${String(s.histOk).padEnd(6)} ${status}`
    )
  }

  console.log('\n' + '═'.repeat(60))
  console.log('  Env vars used:')
  console.log(
    `  TOKEN1 var: ${
      ['ROLLING_INSIGHTS_RSC_TOKEN', 'ROLLING_INSIGHTS_RSC_TOKEN1', 'RI_RSC_TOKEN'].find((k) => process.env[k]) ??
      'NOT FOUND'
    }`
  )
  console.log(
    `  TOKEN2 var: ${
      ['ROLLING_INSIGHTS_RSC_TOKEN2', 'RI_RSC_TOKEN2', 'ROLLING_INSIGHTS_RSC_TOKEN_2'].find((k) => process.env[k]) ??
      'NOT FOUND'
    }`
  )
  console.log('═'.repeat(60))
}

void main().catch(console.error)
