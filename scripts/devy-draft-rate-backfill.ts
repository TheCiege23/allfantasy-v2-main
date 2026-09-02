/**
 * Measure P(drafted) for a college recruit, from CFBD history.
 *
 * ⚠ WHY THIS EXISTS. lib/trade-intel/devyOutlook.ts reports
 * `pReachesRelevance: null` because the devy table holds only forward-looking
 * cohorts (draftEligibleYear 2026-2029) — nobody in it has had the chance to be
 * drafted, so P has never been observed. This builds the missing outcome cohort
 * from years that HAVE resolved.
 *
 * ⚠ NO DATABASE WRITES, DELIBERATELY. The output is a few dozen rates, not
 * 17,000 historical player rows. Storing the cohort would need a migration on
 * prod and would pollute the devy board with players nobody can roster; storing
 * the RATES makes them reviewable in a diff and testable without a database.
 * The script reads CFBD and writes ONE generated TypeScript file.
 *
 * ⚠ WHAT "DRAFTED" MEANS HERE, AND WHAT IT DOES NOT. This measures
 * P(selected in the NFL draft), because that is the only outcome CFBD states
 * directly. It is NOT P(fantasy relevance) — plenty of day-three picks never
 * score a point. The generated file labels the rates `drafted` for that reason
 * and nothing downstream should rename them.
 *
 * ⚠ ABORTS RATHER THAN EMITTING PARTIAL RATES. If any year fails to load, the
 * denominator for that cohort would be wrong in a way no consumer could see —
 * a quota wall would quietly become "fewer players got drafted that year". See
 * lib/cfbd-fetch.ts for why that failure mode is not hypothetical.
 *
 * Usage:
 *   npx tsx scripts/devy-draft-rate-backfill.ts            # writes the table
 *   npx tsx scripts/devy-draft-rate-backfill.ts --dry-run  # prints, writes nothing
 */

import fs from 'node:fs'
import path from 'node:path'

import { cfbdGet, describeCfbdFailure, type CfbdFailure } from '../lib/cfbd-fetch'

/**
 * Recruit classes to measure. Each needs its full outcome window (C+3..C+5) to
 * have already happened, so the newest class here is bounded by the newest
 * draft year below rather than by today.
 */
const RECRUIT_CLASSES = [2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020]

/**
 * Seasons to read college production from.
 *
 * ⚠ SPANS EVERY COHORT'S PLAYING WINDOW, NOT JUST THE RECRUIT YEARS. A recruit
 * from the 2013 class can produce in 2013-2018; one from 2020 in 2020-2025. The
 * union is what a peak-production figure needs, and a short list would silently
 * clip the older cohorts' best seasons and understate them.
 */
const PPA_SEASONS = [
  2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025,
]

/** Draft years to read outcomes from. Ten classes, as commissioned. */
const DRAFT_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]

/**
 * How long after arriving on campus a recruit can be drafted. Three years is the
 * NFL eligibility floor; five covers redshirts and fifth-year seniors. A recruit
 * drafted outside this window is still counted — the window only decides which
 * classes have fully resolved.
 */
const OUTCOME_WINDOW = [3, 4, 5]

const OUT_FILE = path.resolve(process.cwd(), 'lib/devy/draftRates.generated.ts')

type Recruit = {
  name?: string
  position?: string
  stars?: number
  year?: number
  /** Continuous recruiting composite, 0.70-1.00. Same coverage as `stars`. */
  rating?: number
}
type Pick = { name?: string; position?: string; year?: number }

/**
 * Fantasy-relevant groups only — the rest are not devy assets.
 *
 * ⚠ THE RECRUITING FEED AND THE DRAFT FEED DO NOT USE THE SAME POSITION
 * VOCABULARY, AND THE RECRUITING ONE IS RECRUITING-SITE SHORTHAND. Measured
 * against `/recruiting/players?year=2018` (4,348 rows):
 *
 *     PRO 167   DUAL 115   QB 2   APB 53   ATH 313
 *
 * A quarterback recruit is almost never labelled `QB`. He is `PRO` (pro-style)
 * or `DUAL` (dual-threat), and the word "quarterback" appears nowhere in the
 * feed. The first version of this function tested `includes('quarterback')`,
 * which matched 2 of 284 QBs in that class — so the QB cell came back
 * 1 recruit / 0 drafted across all eight classes and would have priced every
 * devy quarterback at a confident zero. Likewise `includes('all-purpose')`
 * never matches the actual token, which is `APB`.
 *
 * ⚠ `ATH` IS DELIBERATELY NOT MAPPED. "Athlete" is the feed's way of saying
 * the position is undecided; those recruits become defensive backs as often as
 * receivers. Folding them into a skill group would inflate the denominator with
 * players who were never devy assets and depress every rate.
 *
 * Exact equality, not `includes`, for the shorthand tokens — `pro` and `dual`
 * are short enough to substring-match unrelated labels.
 */
function positionGroup(raw: string | undefined): 'QB' | 'RB' | 'WR' | 'TE' | null {
  const p = (raw ?? '').toLowerCase().trim()
  if (p.includes('quarterback') || p === 'qb' || p === 'pro' || p === 'dual') return 'QB'
  if (
    p.includes('running back') ||
    p.includes('all-purpose') ||
    p === 'rb' ||
    p === 'fb' ||
    p === 'apb'
  )
    return 'RB'
  if (p.includes('receiver') || p === 'wr') return 'WR'
  if (p.includes('tight end') || p === 'te') return 'TE'
  return null
}

/**
 * ⚠ THE JOIN IS BY NAME, WHICH IS THE WEAK POINT OF THE WHOLE MEASUREMENT.
 * CFBD recruiting and CFBD draft data are separate feeds with no shared id we
 * can rely on, so the hit rate is reported alongside the rates and a low one
 * invalidates them.
 */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function readKey(): string {
  /*
   * .env deliberately, NOT .env.local — the latter carries production database
   * credentials this script has no business loading, and only the CFBD key is
   * needed here.
   */
  for (const file of ['.env', '.env.local']) {
    const full = path.resolve(process.cwd(), file)
    if (!fs.existsSync(full)) continue
    const body = fs.readFileSync(full, 'utf8')
    for (const name of ['CFBD_API_KEY', 'CFBD_KEY', 'COLLEGE_FOOTBALL_DATA_API_KEY']) {
      const m = body.match(new RegExp(`^${name}=(.*)$`, 'm'))
      const v = m?.[1]?.trim().replace(/^["']|["']$/g, '')
      if (v) return v
    }
  }
  return process.env.CFBD_API_KEY ?? process.env.CFBD_KEY ?? ''
}

/**
 * ⚠ THROWS RATHER THAN CALLING process.exit(). Exiting while a fetch is still
 * in flight trips `UV_HANDLE_CLOSING` on Windows and replaces the exit code with
 * 127, so a CI step reading the code sees a crash rather than the deliberate
 * refusal. Unwinding normally keeps the code truthful.
 */
class BackfillAbort extends Error {}

function die(failure: CfbdFailure, context: string): never {
  let message = `${context}: ${describeCfbdFailure(failure)}`
  if (failure.kind === 'quota') {
    message +=
      '\nThe monthly CFBD allowance is exhausted. Rates computed from a partial fetch would\n' +
      'understate every cohort, so nothing was written. Re-run after the quota resets.'
  }
  throw new BackfillAbort(message)
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const key = readKey()
  if (!key) {
    throw new BackfillAbort('No CFBD key found in .env or the environment.')
  }

  // ── Outcomes ────────────────────────────────────────────────────────────
  const draftedByYear = new Map<number, Set<string>>()
  for (const year of DRAFT_YEARS) {
    const res = await cfbdGet<Pick[]>(`/draft/picks?year=${year}`, key)
    if (!res.ok) die(res.failure, `draft picks ${year}`)
    const set = new Set<string>()
    for (const p of res.data) {
      const group = positionGroup(p.position)
      if (!group || !p.name) continue
      set.add(`${normalizeName(p.name)}|${group}`)
    }
    draftedByYear.set(year, set)
    console.log(`draft ${year}: ${set.size} fantasy-relevant picks`)
    await new Promise((r) => setTimeout(r, 300))
  }

  // ── College production ──────────────────────────────────────────────────
  /*
   * Peak single-season PPA per player, across every season he appeared.
   *
   * ⚠ ABSENCE IS A MEASUREMENT HERE, NOT A GAP. `/ppa/players/season` carries
   * ~3,500 players a season — the ones who actually took meaningful snaps —
   * against a recruit cohort of ~10,000. A recruit who never appears did not go
   * unmeasured; he never produced. He is therefore kept with a peak of zero
   * rather than dropped, because dropping him would condition the whole table on
   * having played, which is most of what the table is trying to predict.
   *
   * ⚠ PEAK, NOT CAREER TOTAL. A career sum rewards staying in college five
   * years, which is negatively correlated with being drafted early. The best
   * season is the closer proxy for how good the player actually was.
   */
  type PpaRow = {
    name?: string
    position?: string
    totalPPA?: { all?: number } | null
    averagePPA?: { all?: number } | null
  }
  /*
   * ⚠ BOTH SCALES ARE COLLECTED BECAUSE THE DEVY TABLE STORES THE OTHER ONE.
   * `DevyPlayer.ppaTotal` is written from `averagePPA.all` (a per-play figure,
   * ~0.7), NOT from `totalPPA.all` (a season sum, 20-400) — despite its name.
   * Fitting on the season sum and looking it up against that column would put
   * every current player in the bottom band and price the entire pool at a
   * confident near-zero, uniformly enough that nothing would look wrong.
   *
   * So both are measured and the choice below is made on evidence rather than
   * on which one sounds better.
   */
  const peakPpa = new Map<string, number>()
  const peakAvgPpa = new Map<string, number>()

  for (const season of PPA_SEASONS) {
    const res = await cfbdGet<PpaRow[]>(`/ppa/players/season?year=${season}`, key)
    if (!res.ok) die(res.failure, `ppa ${season}`)
    let kept = 0
    for (const row of res.data) {
      const group = positionGroup(row.position)
      if (!group || !row.name) continue
      const total = row.totalPPA?.all
      const avg = row.averagePPA?.all
      const k = `${normalizeName(row.name)}|${group}`
      if (typeof total === 'number' && Number.isFinite(total)) {
        const prev = peakPpa.get(k)
        if (prev == null || total > prev) peakPpa.set(k, total)
        kept++
      }
      if (typeof avg === 'number' && Number.isFinite(avg)) {
        const prevA = peakAvgPpa.get(k)
        if (prevA == null || avg > prevA) peakAvgPpa.set(k, avg)
      }
    }
    console.log(`ppa ${season}: ${res.data.length} rows, ${kept} skill-position seasons`)
    await new Promise((r) => setTimeout(r, 300))
  }
  console.log(`peak PPA held for ${peakPpa.size} distinct skill players
`)

  // ── Cohorts ─────────────────────────────────────────────────────────────
  type Cell = { recruits: number; drafted: number }
  const cells = new Map<string, Cell>()
  let totalRecruits = 0
  let totalDrafted = 0

  /*
   * Every recruit kept as an observation, not just a tally.
   *
   * ⚠ THE TALLY CANNOT ANSWER THE QUESTION THIS CALIBRATION EXISTS FOR. Star
   * cells say a 4-star receiver is drafted 21% of the time; they cannot say
   * whether the 0.95-rated 4-star differs from the 0.89-rated one. Testing that
   * needs the individual rows, so they are held and the within-tier split is
   * measured below rather than assumed.
   */
  const observations: Array<{
    position: string
    stars: number
    rating: number
    drafted: boolean
    peakPpa: number
    peakAvgPpa: number
  }> = []

  for (const cls of RECRUIT_CLASSES) {
    const res = await cfbdGet<Recruit[]>(`/recruiting/players?year=${cls}`, key)
    if (!res.ok) die(res.failure, `recruits ${cls}`)

    const window = OUTCOME_WINDOW.map((d) => cls + d).filter((y) => draftedByYear.has(y))
    if (window.length !== OUTCOME_WINDOW.length) {
      throw new BackfillAbort(
        `recruit class ${cls} needs draft years ${OUTCOME_WINDOW.map((d) => cls + d).join(', ')}, ` +
          `but only ${window.join(', ') || 'none'} were loaded. A short window undercounts every cell.`,
      )
    }

    let classRecruits = 0
    let classDrafted = 0
    for (const r of res.data) {
      const group = positionGroup(r.position)
      if (!group || !r.name) continue
      const stars = Number.isFinite(r.stars) ? Number(r.stars) : 0
      if (stars < 2) continue // unrated recruits are not a devy population

      const cellKey = `${group}|${stars}`
      const cell = cells.get(cellKey) ?? { recruits: 0, drafted: 0 }
      cell.recruits++
      classRecruits++

      const needle = `${normalizeName(r.name)}|${group}`
      const drafted = window.some((y) => draftedByYear.get(y)!.has(needle))
      if (drafted) {
        cell.drafted++
        classDrafted++
      }
      cells.set(cellKey, cell)

      if (typeof r.rating === 'number' && Number.isFinite(r.rating)) {
        observations.push({
          position: group,
          stars,
          rating: r.rating,
          drafted,
          // Never produced a measured season => 0, not missing. See the note above.
          peakPpa: peakPpa.get(needle) ?? 0,
          peakAvgPpa: peakAvgPpa.get(needle) ?? 0,
        })
      }
    }
    totalRecruits += classRecruits
    totalDrafted += classDrafted
    console.log(
      `recruits ${cls}: ${classRecruits} rated skill players, ${classDrafted} later drafted ` +
        `(${((classDrafted / Math.max(1, classRecruits)) * 100).toFixed(1)}%)`,
    )
    await new Promise((r) => setTimeout(r, 300))
  }

  // ── Report ──────────────────────────────────────────────────────────────
  const rows = [...cells.entries()]
    .map(([k, v]) => {
      const [position, stars] = k.split('|')
      return { position, stars: Number(stars), ...v, rate: v.drafted / v.recruits }
    })
    .sort((a, b) => a.position.localeCompare(b.position) || b.stars - a.stars)

  console.log('\nposition stars  recruits  drafted   rate')
  for (const r of rows) {
    console.log(
      `${r.position.padEnd(9)}${String(r.stars).padEnd(7)}${String(r.recruits).padStart(8)}` +
        `${String(r.drafted).padStart(9)}${(r.rate * 100).toFixed(1).padStart(7)}%`,
    )
  }
  const overall = totalDrafted / Math.max(1, totalRecruits)
  console.log(`\noverall: ${totalDrafted}/${totalRecruits} = ${(overall * 100).toFixed(2)}%`)

  /*
   * ── DID THE PRODUCTION JOIN LAND? ─────────────────────────────────────────
   * Reported before anything is fitted on it. A low match rate is a broken name
   * join, and every production cell built on it would then be a statement about
   * spelling rather than about football.
   */
  {
    const withPpa = observations.filter((o) => o.peakPpa > 0)
    const draftedWithPpa = withPpa.filter((o) => o.drafted).length
    const draftedTotal = observations.filter((o) => o.drafted).length
    const ppas = withPpa.map((o) => o.peakPpa).sort((a, b) => a - b)
    const q = (f: number) => ppas[Math.floor(ppas.length * f)] ?? 0
    console.log('')
    console.log(
      `production join: ${withPpa.length}/${observations.length} recruits have a measured season ` +
        `(${((withPpa.length / Math.max(1, observations.length)) * 100).toFixed(1)}%)`,
    )
    console.log(
      `  of the ${draftedTotal} drafted, ${draftedWithPpa} have one ` +
        `(${((draftedWithPpa / Math.max(1, draftedTotal)) * 100).toFixed(1)}%)`,
    )
    console.log(
      `  peak PPA  min ${ppas[0]?.toFixed(1)}  p25 ${q(0.25).toFixed(1)}  med ${q(0.5).toFixed(1)}` +
        `  p75 ${q(0.75).toFixed(1)}  p90 ${q(0.9).toFixed(1)}  max ${ppas[ppas.length - 1]?.toFixed(1)}`,
    )
  }

  /*
   * ── DOES THE CONTINUOUS COMPOSITE ADD ANYTHING OVER THE STAR BUCKET? ──────
   *
   * ⚠ THIS IS MEASURED BEFORE IT IS SHIPPED, BECAUSE THE ANSWER COULD BE NO.
   * Stars are a ROUNDING of the composite — a 4-star is roughly 0.89-0.98 — so
   * the two are not independent signals and the composite may carry nothing the
   * bucket has not already spent. If it does not separate, a per-player table
   * built on it would be noise wearing a decimal point.
   *
   * The test: inside each (position, stars) cell, split at that cell's own
   * MEDIAN rating and compare the draft rate of the upper half against the
   * lower. Splitting at the cell median rather than a global one is what keeps
   * this a test of the composite rather than a re-test of stars.
   */
  const withinTier: Array<{
    position: string
    stars: number
    n: number
    lowerRate: number
    upperRate: number
    lowerDrafted: number
    upperDrafted: number
    /** ⚠ Null when the lower half had ZERO drafted — a ratio, not a big number. */
    lift: number | null
  }> = []

  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    for (const stars of [4, 3, 2]) {
      const tier = observations.filter((o) => o.position === position && o.stars === stars)
      if (tier.length < 100) continue // too thin to split in half and still say anything

      const sorted = [...tier].sort((a, b) => a.rating - b.rating)
      const mid = Math.floor(sorted.length / 2)
      const rate = (rows: typeof tier) =>
        rows.filter((o) => o.drafted).length / Math.max(1, rows.length)

      const lowerRows = sorted.slice(0, mid)
      const upperRows = sorted.slice(mid)
      const lowerRate = rate(lowerRows)
      const upperRate = rate(upperRows)

      /*
       * ⚠ A ZERO DENOMINATOR IS NOT AN INFINITE LIFT. The first version divided
       * by `Math.max(1e-9, lowerRate)`, so QB 2-star — zero drafted in the lower
       * half — reported a lift of 990,702,294x and dragged the mean to 755,859x.
       * That one was absurd enough to catch by eye; a slightly less extreme cell
       * would have produced a large, plausible, wrong number instead. Null means
       * "no ratio exists here", and the summary below excludes it rather than
       * averaging it in.
       */
      withinTier.push({
        position,
        stars,
        n: tier.length,
        lowerRate: Number(lowerRate.toFixed(6)),
        upperRate: Number(upperRate.toFixed(6)),
        lowerDrafted: lowerRows.filter((o) => o.drafted).length,
        upperDrafted: upperRows.filter((o) => o.drafted).length,
        lift: lowerRate > 0 ? Number((upperRate / lowerRate).toFixed(3)) : null,
      })
    }
  }

  console.log('')
  console.log('within-star split at each cell median (does composite add signal?)')
  console.log('position stars      n   lower%   upper%   (n drafted)     lift')
  for (const w of withinTier) {
    console.log(
      `${w.position.padEnd(9)}${String(w.stars).padEnd(6)}${String(w.n).padStart(7)}` +
        `${(w.lowerRate * 100).toFixed(1).padStart(9)}${(w.upperRate * 100).toFixed(1).padStart(9)}` +
        `${`  (${w.lowerDrafted} vs ${w.upperDrafted})`.padStart(14)}` +
        `${(w.lift == null ? 'n/a' : w.lift.toFixed(2) + 'x').padStart(9)}`,
    )
  }

  /*
   * ── THE PER-PLAYER TABLE ──────────────────────────────────────────────────
   *
   * P(drafted | position, composite band). Earned by the split above: the
   * composite separates within the star bucket in 10 of 11 rateable tiers at a
   * mean lift of 2.25x, so it carries information the bucket has already
   * rounded away. Had it not separated, this table would not exist.
   *
   * ⚠ BANDS, NOT A REGRESSION, AND THAT IS DELIBERATE. A logistic fit would give
   * a smooth per-player probability and a false impression of precision — the
   * outcome is binary, the cohort is ~10,000, and several cells rest on single
   * digits of drafted players. Bands keep every cell's denominator visible so a
   * consumer can see what a number rests on, which is the same reason the star
   * table ships `recruits` alongside `rate`.
   */
  /*
   * ── DOES COLLEGE PRODUCTION ADD ANYTHING OVER THE RECRUITING COMPOSITE? ────
   *
   * ⚠ THE SAME QUESTION ASKED OF THE COMPOSITE, AND FOR THE SAME REASON. Better
   * recruits produce more, so production and composite are correlated and the
   * second may be spending information the first already has. If it does not
   * separate INSIDE a composite band, a production table would be re-describing
   * recruiting rank with extra steps.
   *
   * Two splits, because they answer different things:
   *   played?  — did he ever take meaningful snaps (peak PPA > 0)
   *   how much — among those who did, upper vs lower half of that cell
   *
   * The first is expected to be large. The second is the one that decides
   * whether a CONTINUOUS production signal is worth keying a table on, rather
   * than a boolean.
   */
  /*
   * ⚠ WHICH PPA SCALE SEPARATES BETTER, MEASURED SIDE BY SIDE. Volume-and-quality
   * (totalPPA) against pure per-play efficiency (averagePPA), on the SAME players
   * — those who actually played. Efficiency alone rates a ten-snap specialist
   * level with a workhorse, so it is expected to separate worse; that expectation
   * is checked rather than assumed, because only one of the two matches the
   * column the devy pool already stores.
   */
  console.log('')
  console.log('PPA scale comparison, among players with a measured season')
  console.log('pos     n   totalPPA lo%/hi%   lift  |  avgPPA lo%/hi%   lift')
  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    const played = observations.filter((o) => o.position === position && o.peakPpa > 0)
    if (played.length < 80) continue
    const rate = (rows: typeof played) =>
      rows.length === 0 ? null : rows.filter((o) => o.drafted).length / rows.length
    const halves = (key: 'peakPpa' | 'peakAvgPpa') => {
      const sorted = [...played].sort((a, b) => a[key] - b[key])
      const mid = Math.floor(sorted.length / 2)
      return [rate(sorted.slice(0, mid)), rate(sorted.slice(mid))] as const
    }
    const [tLo, tHi] = halves('peakPpa')
    const [aLo, aHi] = halves('peakAvgPpa')
    const lift = (a: number | null, b: number | null) =>
      a == null || b == null || a === 0 ? 'n/a' : `${(b / a).toFixed(2)}x`
    const pct = (v: number | null) => (v == null ? '-' : (v * 100).toFixed(1))
    console.log(
      `${position.padEnd(4)}${String(played.length).padStart(6)}` +
        `${`${pct(tLo)}/${pct(tHi)}`.padStart(15)}${lift(tLo, tHi).padStart(8)}  |` +
        `${`${pct(aLo)}/${pct(aHi)}`.padStart(15)}${lift(aLo, aHi).padStart(8)}`,
    )
  }

  const PRODUCTION_PROBE_BANDS: Array<[number, number]> = [
    [0.8, 0.85],
    [0.85, 0.9],
    [0.9, 1.01],
  ]
  console.log('')
  console.log('within-composite-band split on college production')
  console.log('pos  band         n   never%   played%   lift |  playedLo%  playedHi%   lift')
  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    for (const [lo, hi] of PRODUCTION_PROBE_BANDS) {
      const cell = observations.filter(
        (o) => o.position === position && o.rating >= lo && o.rating < hi,
      )
      if (cell.length < 80) continue
      const never = cell.filter((o) => o.peakPpa === 0)
      const played = cell.filter((o) => o.peakPpa > 0)
      const rate = (rows: typeof cell) =>
        rows.length === 0 ? null : rows.filter((o) => o.drafted).length / rows.length

      const neverRate = rate(never)
      const playedRate = rate(played)

      const sortedPlayed = [...played].sort((a, b) => a.peakPpa - b.peakPpa)
      const mid = Math.floor(sortedPlayed.length / 2)
      const loRate = rate(sortedPlayed.slice(0, mid))
      const hiRate = rate(sortedPlayed.slice(mid))

      /* ⚠ Null denominators give null lifts, never a huge number. Same rule as
       * the within-star split, which reported 990,702,294x before it was fixed. */
      const lift = (a: number | null, b: number | null) =>
        a == null || b == null || a === 0 ? 'n/a' : `${(b / a).toFixed(2)}x`
      const pct = (v: number | null) => (v == null ? '  -  ' : `${(v * 100).toFixed(1)}`)

      console.log(
        `${position.padEnd(4)} ${lo.toFixed(2)}-${hi.toFixed(2)}${String(cell.length).padStart(6)}` +
          `${pct(neverRate).padStart(8)}${pct(playedRate).padStart(10)}${lift(neverRate, playedRate).padStart(7)} |` +
          `${pct(loRate).padStart(11)}${pct(hiRate).padStart(11)}${lift(loRate, hiRate).padStart(7)}`,
      )
    }
  }

  const COMPOSITE_BANDS: Array<[number, number]> = [
    [0, 0.8],
    [0.8, 0.85],
    [0.85, 0.9],
    [0.9, 0.95],
    [0.95, 1.01],
  ]
  const bandIndexFor = (rating: number) =>
    COMPOSITE_BANDS.findIndex(([lo, hi]) => rating >= lo && rating < hi)

  const compositeCells = new Map<string, { recruits: number; drafted: number }>()
  for (const o of observations) {
    const bi = bandIndexFor(o.rating)
    if (bi < 0) continue
    const k = `${o.position}|${bi}`
    const c = compositeCells.get(k) ?? { recruits: 0, drafted: 0 }
    c.recruits++
    if (o.drafted) c.drafted++
    compositeCells.set(k, c)
  }

  const compositeRows = [...compositeCells.entries()]
    .map(([k, v]) => {
      const [position, bi] = k.split('|')
      const [min, max] = COMPOSITE_BANDS[Number(bi)]
      return {
        position,
        compositeMin: min,
        compositeMax: max,
        recruits: v.recruits,
        drafted: v.drafted,
        rate: Number((v.drafted / v.recruits).toFixed(6)),
      }
    })
    .sort(
      (a, b) => a.position.localeCompare(b.position) || b.compositeMin - a.compositeMin,
    )

  console.log('')
  console.log('position   composite band   recruits  drafted    rate')
  for (const r of compositeRows) {
    console.log(
      `${r.position.padEnd(11)}${`${r.compositeMin.toFixed(2)}-${r.compositeMax.toFixed(2)}`.padEnd(17)}` +
        `${String(r.recruits).padStart(8)}${String(r.drafted).padStart(9)}` +
        `${(r.rate * 100).toFixed(1).padStart(8)}%`,
    )
  }

  /*
   * ⚠ SAME COVERAGE GUARD AS THE STAR TABLE, FOR THE SAME REASON. A position
   * that produces no rateable band is a vocabulary or coverage failure, and the
   * overall figure stays plausible while it happens.
   */
  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    const rateable = compositeRows.filter((r) => r.position === position && r.recruits >= 50)
    if (rateable.length === 0) {
      throw new BackfillAbort(
        `${position} has no composite band with 50+ recruits. That is a coverage or ` +
          'vocabulary failure, not a finding. Nothing written.',
      )
    }
  }

  /*
   * ── THE PRODUCTION TABLE ──────────────────────────────────────────────────
   *
   * P(drafted | position, peak season-total PPA band). The strongest of the
   * three signals by a wide margin, and the only one that MOVES: recruiting rank
   * is fixed before a player arrives, production changes every week he plays.
   *
   * ⚠ PLAYERS WITH NO MEASURED SEASON ARE EXCLUDED FROM THIS TABLE, AND THAT IS
   * THE MOST IMPORTANT LINE IN THIS FILE. In the historical cohort, peak PPA of
   * zero means "never produced across an entire college career" — a resolved
   * outcome, drafted 0-3% of the time. For a CURRENT player it means "has not
   * produced YET", which for a true freshman is not information at all. The two
   * are the same number and opposite facts.
   *
   * Shipping a zero band would therefore price every incoming freshman at a
   * finished bust's rate, confidently and silently. Consumers must fall back to
   * the recruiting composite when a player has no production, which is exactly
   * the right hierarchy: recruiting rank until he plays, production thereafter.
   */
  /*
   * ⚠ QUINTILES WITHIN POSITION, NOT FIXED CUTS ACROSS ALL OF THEM. Season-total
   * PPA is not on one scale: a quarterback touches the ball every snap and
   * accumulates several times what a receiver does. Fixed bands measured that
   * directly — at a 100+ cut, QB held 293 players and RB held NINE, so the
   * elite running backs and tight ends, the ones a devy manager most wants
   * priced, fell under the sample floor and returned null.
   *
   * Quintiles give every cell roughly a fifth of that position's played
   * population by construction, and the boundaries are stored so a lookup can
   * place a current player on the same scale the fit used.
   */
  const productionRows: Array<{
    position: string
    quintile: number
    ppaMin: number
    ppaMax: number | null
    recruits: number
    drafted: number
    rate: number
  }> = []

  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    const played = observations
      .filter((o) => o.position === position && o.peakPpa > 0)
      .sort((a, b) => a.peakPpa - b.peakPpa)
    if (played.length < 100) continue

    const size = Math.floor(played.length / 5)
    for (let qi = 0; qi < 5; qi++) {
      const slice = qi === 4 ? played.slice(qi * size) : played.slice(qi * size, (qi + 1) * size)
      if (slice.length === 0) continue
      const drafted = slice.filter((o) => o.drafted).length
      productionRows.push({
        position,
        quintile: qi + 1,
        ppaMin: Number(slice[0].peakPpa.toFixed(3)),
        // The top quintile is open-ended: a player better than anyone measured
        // still belongs in it rather than falling off the table.
        ppaMax: qi === 4 ? null : Number(slice[slice.length - 1].peakPpa.toFixed(3)),
        recruits: slice.length,
        drafted,
        rate: Number((drafted / slice.length).toFixed(6)),
      })
    }
  }
  productionRows.sort(
    (a, b) => a.position.localeCompare(b.position) || b.quintile - a.quintile,
  )

  console.log('')
  console.log('position  q  peak PPA range     players  drafted    rate')
  for (const r of productionRows) {
    console.log(
      `${r.position.padEnd(10)}${String(r.quintile).padEnd(3)}` +
        `${`${r.ppaMin}-${r.ppaMax ?? 'inf'}`.padEnd(19)}` +
        `${String(r.recruits).padStart(7)}${String(r.drafted).padStart(9)}` +
        `${(r.rate * 100).toFixed(1).padStart(8)}%`,
    )
  }

  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    if (!productionRows.some((r) => r.position === position && r.recruits >= 50)) {
      throw new BackfillAbort(
        `${position} has no production band with 50+ players. That is a join or ` +
          'coverage failure, not a finding. Nothing written.',
      )
    }
  }

  const rated = withinTier.filter((w) => w.lift != null)
  const meanLift =
    rated.length === 0 ? 0 : rated.reduce((a, w) => a + (w.lift as number), 0) / rated.length
  const separates = rated.filter((w) => (w.lift as number) > 1).length
  console.log(
    `composite separates in ${separates}/${rated.length} rateable tiers, ` +
      `mean lift ${meanLift.toFixed(2)}x (${withinTier.length - rated.length} unrateable)`,
  )


  /*
   * ⚠ A HIT RATE THIS LOW WOULD MEAN THE NAME JOIN FAILED, not that nobody got
   * drafted. Roughly 1.5-3% of rated skill recruits are drafted; an order of
   * magnitude below that is a broken match, and shipping it would put a
   * confidently tiny probability on every devy asset.
   */
  if (overall < 0.002) {
    throw new BackfillAbort(
      `overall drafted rate ${(overall * 100).toFixed(3)}% is implausibly low. ` +
        'That is a failed name join, not a finding. Nothing written.',
    )
  }

  /*
   * ⚠ AND THE OVERALL RATE CANNOT SEE A SINGLE POSITION COLLAPSING. That is not
   * hypothetical: with `PRO`/`DUAL` unmapped the QB cell held ONE recruit out of
   * 7,524 and the overall rate was 4.57% — comfortably plausible, because WR, RB
   * and TE carried it. An aggregate check over four cells passes while one of
   * them is empty, and QB is the cell a devy board can least afford to lose.
   *
   * So assert each group holds a believable share of the rated population. The
   * measured shares are roughly WR 45%, QB 23%, RB 21%, TE 13%; a 3% floor
   * leaves every one of them at least 4x of headroom while still catching a
   * vocabulary mismatch, which fails by two orders of magnitude rather than by a
   * few points.
   */
  for (const group of ['QB', 'RB', 'WR', 'TE'] as const) {
    const recruits = rows
      .filter((r) => r.position === group)
      .reduce((n, r) => n + r.recruits, 0)
    const drafted = rows
      .filter((r) => r.position === group)
      .reduce((n, r) => n + r.drafted, 0)
    const share = recruits / Math.max(1, totalRecruits)

    if (share < 0.03) {
      throw new BackfillAbort(
        `${group} is ${(share * 100).toFixed(2)}% of the rated recruit pool ` +
          `(${recruits}/${totalRecruits}). That is a position-vocabulary mismatch in ` +
          'positionGroup(), not a finding — the recruiting feed uses shorthand ' +
          '(PRO/DUAL for QB, APB for RB). Nothing written.',
      )
    }
    if (drafted === 0) {
      throw new BackfillAbort(
        `${group} has ${recruits} recruits and zero drafted. That is a failed name ` +
          'join for this position, not a finding. Nothing written.',
      )
    }
  }

  if (dryRun) {
    console.log('\n--dry-run: nothing written.')
    return
  }

  const generated = `/**
 * GENERATED by scripts/devy-draft-rate-backfill.ts — do not edit by hand.
 *
 * P(selected in the NFL draft) for a rated college skill recruit, measured from
 * CFBD recruiting classes ${RECRUIT_CLASSES[0]}-${RECRUIT_CLASSES[RECRUIT_CLASSES.length - 1]}
 * against draft years ${DRAFT_YEARS[0]}-${DRAFT_YEARS[DRAFT_YEARS.length - 1]}.
 *
 * ⚠ THIS IS "DRAFTED", NOT "FANTASY RELEVANT". Plenty of day-three picks never
 * score. Do not rename these fields to imply otherwise.
 *
 * ⚠ SAMPLE SIZES ARE PART OF THE DATA. A cell with a handful of recruits is not
 * a rate; consumers must check \`recruits\` before trusting \`rate\`.
 *
 * Recruits are joined to draft picks BY NAME, which is the weakest link in the
 * measurement. Overall hit rate at generation: ${(overall * 100).toFixed(2)}%.
 */

export type DraftRateCell = {
  position: 'QB' | 'RB' | 'WR' | 'TE'
  stars: number
  /** Rated recruits in this cell across all measured classes. */
  recruits: number
  /** How many were later selected in the NFL draft. */
  drafted: number
  /** drafted / recruits. */
  rate: number
}

export const DRAFT_RATE_PROVENANCE = {
  recruitClasses: ${JSON.stringify(RECRUIT_CLASSES)},
  draftYears: ${JSON.stringify(DRAFT_YEARS)},
  outcomeWindowYears: ${JSON.stringify(OUTCOME_WINDOW)},
  totalRecruits: ${totalRecruits},
  totalDrafted: ${totalDrafted},
  overallRate: ${overall.toFixed(6)},
  /** True: these rates came from a completed backfill, not the placeholder. */
  measured: true,
} as const

export const DRAFT_RATES: DraftRateCell[] = ${JSON.stringify(
    rows.map((r) => ({
      position: r.position,
      stars: r.stars,
      recruits: r.recruits,
      drafted: r.drafted,
      rate: Number(r.rate.toFixed(6)),
    })),
    null,
    2,
  )}

export interface ProductionRateCell {
  position: 'QB' | 'RB' | 'WR' | 'TE'
  /** 1 (least productive fifth) to 5 (most). */
  quintile: number
  ppaMin: number
  /** Null on the top quintile, which is open-ended. */
  ppaMax: number | null
  recruits: number
  drafted: number
  rate: number
}

/**
 * P(drafted | position, peak season-total PPA quintile).
 *
 * ⚠ THE STRONGEST OF THE THREE SIGNALS, AND THE ONLY ONE THAT MOVES. Recruiting
 * rank is fixed before a player arrives; production changes every week he plays.
 * Splitting players who took meaningful snaps at the median, the season total
 * separates drafted from undrafted by 22-176x.
 *
 * ⚠ QUINTILES ARE WITHIN POSITION because season-total PPA is not on one scale
 * across positions — a quarterback accumulates several times a receiver's total.
 * The stored bounds are what place a current player on the fit's own scale.
 *
 * ⚠ AND THERE IS NO ZERO BAND, DELIBERATELY. In this cohort a peak of zero means
 * "never produced across a whole career"; for a current player it means "not
 * yet", which for a freshman is not information. Callers must fall back to the
 * recruiting composite when a player has no production rather than reading him
 * as a finished bust.
 */
export const DRAFT_RATES_BY_PRODUCTION: ProductionRateCell[] = ${JSON.stringify(productionRows, null, 2)}

/**
 * The measured rate for a season-total PPA figure, or null when it is absent,
 * non-positive, or the cell is too thin.
 *
 * ⚠ THE ARGUMENT IS \`DevyPlayer.ppaSeasonTotal\`, NOT \`ppaTotal\`. The latter
 * holds averagePPA.all despite its name and separates by 0.88-2.19x, inverted
 * for WR and TE. Passing it here would be a scale error that degrades the whole
 * pool uniformly enough to look like nothing is wrong.
 */
export function draftRateForProduction(
  position: string,
  ppaSeasonTotal: number | null,
  minSample = 50,
): ProductionRateCell | null {
  if (ppaSeasonTotal == null || !Number.isFinite(ppaSeasonTotal) || ppaSeasonTotal <= 0) return null
  const cells = DRAFT_RATES_BY_PRODUCTION.filter((c) => c.position === position)
  if (cells.length === 0) return null
  // Ascending, so the first cell whose upper bound clears the value wins; the
  // open-ended top quintile catches anything above every measured bound.
  const ascending = [...cells].sort((a, b) => a.quintile - b.quintile)
  const hit =
    ascending.find((c) => c.ppaMax != null && ppaSeasonTotal < c.ppaMax) ??
    ascending[ascending.length - 1]
  if (!hit || hit.recruits < minSample) return null
  return hit
}

export interface CompositeRateCell {
  position: 'QB' | 'RB' | 'WR' | 'TE'
  /** Band is [compositeMin, compositeMax). */
  compositeMin: number
  compositeMax: number
  recruits: number
  drafted: number
  rate: number
}

/**
 * P(drafted | position, recruiting composite band).
 *
 * ⚠ PREFER THIS OVER THE STAR TABLE WHERE A COMPOSITE EXISTS. The composite is
 * what stars are a rounding OF, and it separates outcomes inside the star
 * bucket in 10 of 11 rateable tiers at a mean lift of ${meanLift.toFixed(2)}x — measured,
 * not assumed. It also reaches players the star table cannot: the 0.95+ band
 * holds 65 QBs, 80 RBs and 123 WRs, where the 5-star cells hold 18, 27 and 31
 * and fall under \`minSample\`.
 */
export const DRAFT_RATES_BY_COMPOSITE: CompositeRateCell[] = ${JSON.stringify(compositeRows, null, 2)}

/**
 * The measured rate for a recruiting composite, or null when the band is
 * missing or too thin. Same null-not-zero contract as \`draftRateFor\`.
 */
export function draftRateForComposite(
  position: string,
  composite: number | null,
  minSample = 50,
): CompositeRateCell | null {
  if (composite == null || !Number.isFinite(composite)) return null
  const hit = DRAFT_RATES_BY_COMPOSITE.find(
    (c) => c.position === position && composite >= c.compositeMin && composite < c.compositeMax,
  )
  if (!hit || hit.recruits < minSample) return null
  return hit
}

/**
 * The measured rate for a recruit, or null when we have no cell or too small a
 * one to state a rate. Null is the honest answer; a fabricated rate would put a
 * confident probability on an asset nobody has measured.
 */
export function draftRateFor(
  position: string,
  stars: number | null,
  minSample = 50,
): DraftRateCell | null {
  if (stars == null) return null
  const hit = DRAFT_RATES.find((c) => c.position === position && c.stars === stars)
  if (!hit || hit.recruits < minSample) return null
  return hit
}
`

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true })
  fs.writeFileSync(OUT_FILE, generated, 'utf8')
  console.log(`\nwrote ${OUT_FILE}`)
}

main().catch((err) => {
  console.error(err instanceof BackfillAbort ? `\nABORTED — ${err.message}` : `backfill failed: ${err}`)
  /* Code set, then the process unwinds on its own — see BackfillAbort. */
  process.exitCode = 1
})
