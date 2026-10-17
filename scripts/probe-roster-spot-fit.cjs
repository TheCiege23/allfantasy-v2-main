/**
 * READ-ONLY fit of the roster-spot charge (`lib/trade-value/rosterSpotCharge.ts`) on real completed trades.
 *
 * Prices every Sleeper trade since the first daily FantasyCalc capture (2026-08-16) on the board captured
 * the day it happened, then asks: on trades with uneven player counts, does the side receiving MORE players
 * receive systematically more quoted value, and what per-spot charge removes that lean? Re-run it as trade
 * volume grows; the 2026-10-09 run (447 trades) gave alpha 1.006 on rank teams x roster spots.
 *
 * Every statement runs inside BEGIN READ ONLY, verified before any read. Prints the host, never the URL.
 *
 *   PROBE_ENV_FILE=<path to a .env holding DATABASE_URL> node scripts/probe-roster-spot-fit.cjs
 */
const fs = require('fs')
const { Client } = require('pg')

const envFile = process.env.PROBE_ENV_FILE
if (!envFile) throw new Error('PROBE_ENV_FILE is required')
const line = fs.readFileSync(envFile, 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!line) throw new Error('DATABASE_URL not found in PROBE_ENV_FILE')
const url = line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '')
console.log(`[fit] target host: ${new URL(url).host}`)

const ORD = (r) => (r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`)
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN }
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

;(async () => {
  const c = new Client({ connectionString: url, statement_timeout: 120000 })
  await c.connect()
  await c.query('BEGIN READ ONLY')
  const ro = (await c.query('SHOW transaction_read_only')).rows[0].transaction_read_only
  if (ro !== 'on') throw new Error('not read-only')
  console.log(`[fit] transaction_read_only=${ro}`)

  // ── Books: one per capture day × format × qbFormat ────────────────────────────────────────────
  const pvs = await c.query(`SELECT "capturedAt", format, "qbFormat", "sleeperId", name, position, value
                             FROM "PlayerValueSnapshot" WHERE source='FANTASYCALC' AND "capturedAt" >= '2026-08-16'`)
  const books = new Map() // key -> { at, players: Map, picks: Map, ranked: number[] }
  for (const r of pvs.rows) {
    const key = `${r.capturedAt.toISOString()}|${r.format}|${r.qbFormat}`
    let b = books.get(key)
    if (!b) books.set(key, (b = { at: r.capturedAt, format: r.format, qb: r.qbFormat, players: new Map(), picks: new Map(), ranked: [] }))
    if (r.position === 'PICK') b.picks.set(r.name, r.value)
    else { b.players.set(r.sleeperId, r.value); b.ranked.push(r.value) }
  }
  for (const b of books.values()) b.ranked.sort((x, y) => y - x)
  const captureTimes = [...new Set([...books.values()].map((b) => b.at.getTime()))].sort((a, b) => a - b)
  const bookFor = (when, format, qb) => {
    let t = null
    for (const ct of captureTimes) { if (ct <= when.getTime()) t = ct; else break }
    if (t == null) return null
    return books.get(`${new Date(t).toISOString()}|${format}|${qb}`) ?? null
  }
  console.log(`[fit] books: ${books.size} (${captureTimes.length} capture days)`)

  // ── Trades, one row per transaction, joined to the league ─────────────────────────────────────
  const tr = await c.query(`
    SELECT DISTINCT ON (t."transactionId") t."transactionId" id, t."tradeDate" at,
      t."playersGiven" pg, t."playersReceived" pr, t."picksGiven" kg, t."picksReceived" kr,
      l."isDynasty" dyn, l."leagueType" lt, l."leagueSize" teams, l.settings::jsonb -> 'roster_positions' rp
    FROM "LeagueTrade" t
    JOIN "LeagueTradeHistory" h ON h.id = t."historyId"
    JOIN leagues l ON l."platformLeagueId" = h."sleeperLeagueId" AND l.platform = 'sleeper'
    WHERE t."tradeDate" >= '2026-08-16'
    ORDER BY t."transactionId", t."createdAt"`)
  await c.query('ROLLBACK')
  await c.end()

  const trades = []
  const drop = { noBook: 0, unpriced: 0, emptySide: 0, redraftPick: 0 }
  for (const t of tr.rows) {
    const rp = Array.isArray(t.rp) ? t.rp.map((p) => String(p).toUpperCase()) : []
    const superflex = rp.some((p) => ['SUPER_FLEX', 'SUPERFLEX', 'OP'].includes(p)) || rp.filter((p) => p === 'QB').length >= 2
    const dynasty = Boolean(t.dyn) || /dynasty|keeper/i.test(String(t.lt ?? ''))
    const book = bookFor(t.at, dynasty ? 'DYNASTY' : 'REDRAFT', superflex ? 'SUPERFLEX' : 'ONE_QB')
    if (!book) { drop.noBook++; continue }
    const rosterSpots = rp.filter((p) => !['IR', 'TAXI', 'RESERVE'].includes(p)).length || 25
    const priceSide = (players, picks) => {
      let v = 0
      for (const id of players ?? []) { const x = book.players.get(String(id)); if (x == null) return null; v += x }
      for (const pk of picks ?? []) {
        if (!dynasty) return 'redraftPick'
        const x = book.picks.get(`${pk.season} ${ORD(Number(pk.round))}`)
        if (x == null) return null
        v += x
      }
      return v
    }
    // Side A receives `pr` + `kr`; side B receives `pg` + `kg`.
    const a = priceSide(t.pr, t.kr), b = priceSide(t.pg, t.kg)
    if (a === 'redraftPick' || b === 'redraftPick') { drop.redraftPick++; continue }
    if (a == null || b == null) { drop.unpriced++; continue }
    if (a <= 0 || b <= 0) { drop.emptySide++; continue }
    trades.push({ id: t.id, a, b, na: (t.pr ?? []).length, nb: (t.pg ?? []).length, book, teams: t.teams || 12, rosterSpots, dynasty })
  }
  console.log(`[fit] priced trades: ${trades.length} of ${tr.rows.length} (dropped ${JSON.stringify(drop)})`)

  const even = trades.filter((t) => t.na === t.nb)
  const uneven = trades.filter((t) => t.na !== t.nb)
  // Orient uneven trades from the side receiving MORE players (M) against the side receiving fewer (F).
  const oriented = uneven.map((t) => (t.na > t.nb
    ? { vm: t.a, vf: t.b, n: t.na - t.nb, t }
    : { vm: t.b, vf: t.a, n: t.nb - t.na, t }))
  const lean = (R) => oriented.map((o) => Math.log(o.vm / (o.vf + o.n * (typeof R === 'function' ? R(o.t) : R))))

  console.log(`\n[fit] even trades: ${even.length}  |  uneven: ${uneven.length} (n=1: ${oriented.filter((o) => o.n === 1).length}, n=2: ${oriented.filter((o) => o.n === 2).length}, n>=3: ${oriented.filter((o) => o.n >= 3).length})`)
  // Control: even trades, oriented by the side receiving the single most valuable player (stud side).
  const evenStud = even.map((t) => Math.log(t.a / t.b))
  console.log(`[control] even trades, random orientation: median ln ratio ${median(evenStud).toFixed(3)} (expect ~0)`)

  const l0 = lean(0)
  console.log(`[linear] uneven, more-players side over fewer: median ln ${median(l0).toFixed(3)} (x${Math.exp(median(l0)).toFixed(3)}), mean ${mean(l0).toFixed(3)}, share above 0: ${(l0.filter((x) => x > 0).length / l0.length * 100).toFixed(1)}%`)

  // Flat R that centres the median.
  let lo = 0, hi = 6000
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (median(lean(mid)) > 0) lo = mid; else hi = mid }
  const flatR = (lo + hi) / 2
  console.log(`[flat] R that centres the median: ${flatR.toFixed(0)}  (mean ln then ${mean(lean(flatR)).toFixed(3)})`)

  // Rank-based R: value at rank k of that day's book, k = alpha * teams * rosterSpots.
  const valueAtRank = (book, k) => book.ranked[Math.min(book.ranked.length - 1, Math.max(0, Math.round(k) - 1))] ?? 0
  const alphaR = (alpha) => (t) => valueAtRank(t.book, alpha * t.teams * t.rosterSpots)
  let alo = 0.05, ahi = 3
  for (let i = 0; i < 60; i++) { const mid = (alo + ahi) / 2; if (median(lean(alphaR(mid))) > 0) ahi = mid; else alo = mid }
  const alpha = (alo + ahi) / 2
  const sampleR = oriented.map((o) => alphaR(alpha)(o.t))
  console.log(`[rank] alpha that centres the median: ${alpha.toFixed(3)}  -> rank ~${(alpha * 12 * 25).toFixed(0)} in a 12x25 league; implied R median ${median(sampleR).toFixed(0)} (p10 ${[...sampleR].sort((a,b)=>a-b)[Math.floor(sampleR.length*0.1)]}, p90 ${[...sampleR].sort((a,b)=>a-b)[Math.floor(sampleR.length*0.9)]})`)
  console.log(`[rank] at alpha=1 (exactly the last rostered player): median ln ${median(lean(alphaR(1))).toFixed(3)}, R median ${median(oriented.map((o) => alphaR(1)(o.t))).toFixed(0)}`)

  // Does the charge scale with the number of extra players (n x R)?
  for (const n of [1, 2, 3]) {
    const sub = oriented.filter((o) => (n < 3 ? o.n === n : o.n >= 3))
    if (sub.length < 5) continue
    const before = median(sub.map((o) => Math.log(o.vm / o.vf)))
    const after = median(sub.map((o) => Math.log(o.vm / (o.vf + o.n * alphaR(alpha)(o.t)))))
    console.log(`[by n=${n}${n === 3 ? '+' : ''}] trades ${sub.length}: median ln linear ${before.toFixed(3)} -> with charge ${after.toFixed(3)}`)
  }
  for (const d of [true, false]) {
    const sub = oriented.filter((o) => o.t.dynasty === d)
    if (sub.length < 5) continue
    console.log(`[${d ? 'dynasty' : 'redraft'}] trades ${sub.length}: median ln linear ${median(sub.map((o) => Math.log(o.vm / o.vf))).toFixed(3)} -> with charge ${median(sub.map((o) => Math.log(o.vm / (o.vf + o.n * alphaR(alpha)(o.t))))).toFixed(3)}`)
  }

  // Bootstrap the alpha.
  const rnd = (() => { let s = 12345; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) })()
  const alphas = []
  for (let b = 0; b < 300; b++) {
    const sample = oriented.map(() => oriented[Math.floor(rnd() * oriented.length)])
    let lo2 = 0.05, hi2 = 3
    for (let i = 0; i < 40; i++) {
      const mid = (lo2 + hi2) / 2
      const m = median(sample.map((o) => Math.log(o.vm / (o.vf + o.n * alphaR(mid)(o.t)))))
      if (m > 0) hi2 = mid; else lo2 = mid
    }
    alphas.push((lo2 + hi2) / 2)
  }
  alphas.sort((a, b) => a - b)
  console.log(`[bootstrap] alpha 90% interval: ${alphas[15].toFixed(3)} – ${alphas[284].toFixed(3)}`)

  // Letters that change on this sample (bands +-10 / +-25 on the gap over the larger side).
  const letter = (give, get) => { const d = Math.round((get - give) / Math.max(give, get) * 100); return d >= 25 ? 'A' : d >= 10 ? 'B' : d > -10 ? 'C' : d > -25 ? 'D' : 'F' }
  let changed = 0
  for (const o of oriented) {
    const r = alphaR(alpha)(o.t)
    if (letter(o.vf, o.vm) !== letter(o.vf + o.n * r, o.vm)) changed++
  }
  console.log(`[impact] uneven trades whose letter (more-players side) changes: ${changed} of ${oriented.length} (${(changed / oriented.length * 100).toFixed(1)}%)`)
  console.log('\nFIT_DONE')
})().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
