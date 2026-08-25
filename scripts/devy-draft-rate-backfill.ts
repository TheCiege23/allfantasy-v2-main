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

type Recruit = { name?: string; position?: string; stars?: number; year?: number }
type Pick = { name?: string; position?: string; year?: number }

/** Fantasy-relevant groups only — the rest are not devy assets. */
function positionGroup(raw: string | undefined): 'QB' | 'RB' | 'WR' | 'TE' | null {
  const p = (raw ?? '').toLowerCase()
  if (p.includes('quarterback') || p === 'qb') return 'QB'
  if (p.includes('running back') || p.includes('all-purpose') || p === 'rb' || p === 'fb') return 'RB'
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

  // ── Cohorts ─────────────────────────────────────────────────────────────
  type Cell = { recruits: number; drafted: number }
  const cells = new Map<string, Cell>()
  let totalRecruits = 0
  let totalDrafted = 0

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
      if (window.some((y) => draftedByYear.get(y)!.has(needle))) {
        cell.drafted++
        classDrafted++
      }
      cells.set(cellKey, cell)
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
