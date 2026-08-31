/**
 * Measure E[dynasty market value | NFL-drafted] — the second half of the devy
 * option, and the half that has never been measured here.
 *
 * ⚠ WHY THIS EXISTS. `lib/trade-intel/devyOutlook.ts` states the correct model
 * for a devy asset in one line: P(reaches NFL relevance) x value on arrival x
 * time discount. `scripts/devy-draft-rate-backfill.ts` now supplies P. This
 * supplies the middle term, from realized outcomes rather than analogy.
 *
 * ⚠ THE SURVIVORSHIP TRAP IS THE WHOLE DIFFICULTY, AND IT IS EASY TO WALK INTO.
 * The FantasyCalc dynasty board is ~475 rows. Only 53-74% of drafted skill
 * players appear on it at all; the rest are busts, backups and washouts. So the
 * mean value OF THE PLAYERS ON THE BOARD is not E[value | drafted] — it is
 * E[value | drafted AND it worked out], which is a number about winners. Taking
 * it would price every devy prospect as though the bust case does not exist.
 *
 * Measured on the 2023 class: mean of board hits 2,298 across 42 players, but
 * 80 skill players were drafted. The honest expectation divides by 80, not 42.
 *
 * ⚠ AND OFF-BOARD IS NOT EXACTLY ZERO, SO THE ANSWER IS A BAND, NOT A POINT. A
 * player who misses a 475-row board is worth something small and unmeasured, not
 * nothing. `expectedLow` counts him as 0 (a true lower bound); `expectedHigh`
 * counts him as the board's own minimum value (a generous upper bound, since he
 * ranked below it). The real expectation is inside that band and this file does
 * not pretend to locate it more precisely.
 *
 * ⚠ RECENT CLASSES ONLY, AND THAT IS A CHOICE WITH A REASON. A devy owner
 * receives the player AT ARRIVAL, so the quantity wanted is value on arrival.
 * A 2016 draftee's CURRENT value reflects a finished career, not his rookie
 * price. Recent classes are the closest available proxy for arrival value, and
 * the trade-off is that they are the least settled. Both facts are recorded in
 * the provenance rather than resolved.
 *
 * ⚠ TWO POSITION VOCABULARIES IN ONE PROVIDER. `/draft/picks` uses full names
 * ("Quarterback", "Running Back"); `/recruiting/players` uses recruiting-site
 * shorthand (PRO, DUAL, APB). The draft-rate backfill was bitten by the second.
 * This script only reads the first, so `includes('quarterback')` is correct
 * here — but the two must never share a mapping function on the assumption that
 * one provider speaks one language.
 *
 * Usage:
 *   npx tsx scripts/devy-arrival-value-backfill.ts            # writes the table
 *   npx tsx scripts/devy-arrival-value-backfill.ts --dry-run  # prints only
 */

import fs from 'node:fs'
import path from 'node:path'

import { cfbdGet, describeCfbdFailure, type CfbdFailure } from '../lib/cfbd-fetch'
import { getFantasyCalcValuesDbFirst } from '../lib/fantasycalc-db'

const OUT_FILE = path.resolve(process.cwd(), 'lib/devy/arrivalValues.generated.ts')

/**
 * Draft classes to measure. Recent on purpose — see the arrival-value note above.
 * Three classes is enough to see whether the figure is stable and few enough
 * that every one of them is still arrival-proximate.
 */
const DRAFT_YEARS = [2023, 2024, 2025]

const SETTINGS = { isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 } as const

class Abort extends Error {}

function positionGroup(raw: unknown): 'QB' | 'RB' | 'WR' | 'TE' | null {
  const p = String(raw ?? '').toLowerCase()
  if (p.includes('quarterback')) return 'QB'
  if (p.includes('running back')) return 'RB'
  if (p.includes('receiver')) return 'WR'
  if (p.includes('tight end')) return 'TE'
  return null
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function apiKey(): string {
  for (const f of ['.env.local', '.env']) {
    if (!fs.existsSync(f)) continue
    const body = fs.readFileSync(f, 'utf8')
    for (const name of ['CFBD_API_KEY', 'CFBD_KEY', 'COLLEGE_FOOTBALL_DATA_API_KEY']) {
      const m = body.match(new RegExp(`^${name}=(.+)$`, 'm'))
      if (m && m[1].trim()) return m[1].trim().replace(/^["']|["']$/g, '')
    }
  }
  return process.env.CFBD_API_KEY ?? process.env.CFBD_KEY ?? ''
}

function die(failure: CfbdFailure, what: string): never {
  throw new Abort(`${what}: ${describeCfbdFailure(failure)}`)
}

type Cell = { drafted: number; onBoard: number; sumOnBoard: number }

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const key = apiKey()

  const board = (await getFantasyCalcValuesDbFirst(SETTINGS)) as Array<Record<string, any>>
  if (board.length === 0) {
    throw new Abort('the FantasyCalc board is empty. Nothing can be measured against it.')
  }

  const byName = new Map<string, number>()
  let boardMin = Infinity
  for (const row of board) {
    const name = row?.player?.name ?? row?.name
    const value = Number(row?.value ?? 0)
    if (!name || !Number.isFinite(value)) continue
    byName.set(normalizeName(String(name)), value)
    if (value > 0 && value < boardMin) boardMin = value
  }
  if (!Number.isFinite(boardMin)) boardMin = 0
  console.log(`board: ${board.length} rows, ${byName.size} indexed by name, min value ${boardMin}`)

  const cells = new Map<string, Cell>()
  const overall: Cell = { drafted: 0, onBoard: 0, sumOnBoard: 0 }

  for (const year of DRAFT_YEARS) {
    const res = await cfbdGet<any[]>(`/draft/picks?year=${year}`, key)
    if (!res.ok) die(res.failure, `draft ${year}`)

    let skill = 0
    let hits = 0
    for (const pick of res.data) {
      const group = positionGroup(pick?.position)
      if (!group) continue
      const name = pick?.name ?? [pick?.firstName, pick?.lastName].filter(Boolean).join(' ')
      if (!name) continue
      skill++

      const value = byName.get(normalizeName(String(name)))
      const cell = cells.get(group) ?? { drafted: 0, onBoard: 0, sumOnBoard: 0 }
      cell.drafted++
      overall.drafted++
      if (value != null) {
        hits++
        cell.onBoard++
        cell.sumOnBoard += value
        overall.onBoard++
        overall.sumOnBoard += value
      }
      cells.set(group, cell)
    }
    console.log(
      `draft ${year}: ${skill} skill picks, ${hits} on board ` +
        `(${((hits / Math.max(1, skill)) * 100).toFixed(0)}%)`,
    )
    await new Promise((r) => setTimeout(r, 300))
  }

  /*
   * ⚠ A HIT RATE THIS LOW WOULD BE A FAILED NAME JOIN, NOT A FINDING. Roughly
   * half to three-quarters of drafted skill players appear on a dynasty board.
   * Far below that and the join broke, and the resulting expectation would be
   * confidently tiny for every devy asset — the same failure mode the draft-rate
   * backfill guards against.
   */
  const hitRate = overall.onBoard / Math.max(1, overall.drafted)
  if (hitRate < 0.2) {
    throw new Abort(
      `only ${(hitRate * 100).toFixed(1)}% of drafted skill players matched the board. ` +
        'That is a failed name join, not a finding. Nothing written.',
    )
  }

  const rows = (['QB', 'RB', 'WR', 'TE'] as const)
    .map((position) => {
      const c = cells.get(position)
      if (!c || c.drafted === 0) return null
      const offBoard = c.drafted - c.onBoard
      return {
        position,
        drafted: c.drafted,
        onBoard: c.onBoard,
        boardHitRate: Number((c.onBoard / c.drafted).toFixed(6)),
        meanOnBoard: Math.round(c.sumOnBoard / Math.max(1, c.onBoard)),
        expectedLow: Math.round(c.sumOnBoard / c.drafted),
        expectedHigh: Math.round((c.sumOnBoard + offBoard * boardMin) / c.drafted),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r != null)

  /*
   * ⚠ EVERY POSITION MUST BE PRESENT. A vocabulary mismatch collapses one group
   * while the others carry a plausible overall figure — exactly how the QB cell
   * in the draft-rate backfill read 1 recruit across eight classes while the
   * overall rate looked fine at 4.57%.
   */
  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    if (!rows.some((r) => r.position === position)) {
      throw new Abort(
        `${position} produced no drafted players across ${DRAFT_YEARS.join(', ')}. ` +
          'That is a position-vocabulary mismatch, not a finding. Nothing written.',
      )
    }
  }

  const offBoardOverall = overall.drafted - overall.onBoard
  const expectedLow = Math.round(overall.sumOnBoard / overall.drafted)
  const expectedHigh = Math.round(
    (overall.sumOnBoard + offBoardOverall * boardMin) / overall.drafted,
  )

  console.log('\nposition  drafted  onBoard   hit%   meanOnBoard   E[low]  E[high]')
  for (const r of rows) {
    console.log(
      `${r.position.padEnd(10)}${String(r.drafted).padStart(7)}${String(r.onBoard).padStart(9)}` +
        `${(r.boardHitRate * 100).toFixed(0).padStart(7)}%${String(r.meanOnBoard).padStart(14)}` +
        `${String(r.expectedLow).padStart(9)}${String(r.expectedHigh).padStart(9)}`,
    )
  }
  console.log(
    `\noverall: ${overall.onBoard}/${overall.drafted} on board, ` +
      `E[value | drafted] between ${expectedLow} and ${expectedHigh} board units`,
  )

  if (dryRun) {
    console.log('\n--dry-run: nothing written.')
    return
  }

  const generated = [
    '/**',
    ' * GENERATED by scripts/devy-arrival-value-backfill.ts — do not edit by hand.',
    ' *',
    ' * E[dynasty market value | NFL-drafted], measured over recent draft classes',
    ' * against the FantasyCalc dynasty board.',
    ' *',
    ' * ⚠ THESE ARE BOARD UNITS AND THEY DO NOT RECONCILE WITH lib/pick-curve.ts.',
    ' * FIRST_ROUND_IN_MARKET_UNITS is 950, fitted across 771 real dynasty trades.',
    ' * The expectation below sits in the same neighbourhood or above it, which',
    ' * would imply a randomly chosen drafted skill player is worth more than a',
    ' * fantasy rookie first — which cannot be true. The two were calibrated',
    ' * against different things and the gap is UNRESOLVED. Do not multiply a devy',
    ' * score by these figures and call the result a market price.',
    ' * See ADR-DOS-F2.11 §4.3.',
    ' *',
    ' * ⚠ expectedLow COUNTS AN OFF-BOARD PLAYER AS ZERO; expectedHigh COUNTS HIM',
    ' * AS THE BOARD MINIMUM. The truth is inside that band. meanOnBoard is NOT the',
    ' * expectation — it conditions on the player having worked out.',
    ' */',
    '',
    'export interface ArrivalValueCell {',
    "  position: 'QB' | 'RB' | 'WR' | 'TE'",
    '  /** Skill players drafted at this position across the measured classes. */',
    '  drafted: number',
    '  /** How many of them appear on the dynasty board at all. */',
    '  onBoard: number',
    '  boardHitRate: number',
    '  /** ⚠ Mean of the players ON the board — survivorship-conditioned, not E. */',
    '  meanOnBoard: number',
    '  /** E[value | drafted], counting off-board players as 0. A lower bound. */',
    '  expectedLow: number',
    '  /** E[value | drafted], counting off-board players as the board minimum. */',
    '  expectedHigh: number',
    '}',
    '',
    'export const ARRIVAL_VALUE_PROVENANCE = {',
    `  draftYears: ${JSON.stringify(DRAFT_YEARS)},`,
    `  settings: ${JSON.stringify(SETTINGS)},`,
    `  boardRows: ${board.length},`,
    `  boardMinValue: ${boardMin},`,
    `  totalDrafted: ${overall.drafted},`,
    `  totalOnBoard: ${overall.onBoard},`,
    `  expectedLow: ${expectedLow},`,
    `  expectedHigh: ${expectedHigh},`,
    '  /** True: measured from a completed run, not a placeholder. */',
    '  measured: true,',
    '} as const',
    '',
    `export const ARRIVAL_VALUES: ArrivalValueCell[] = ${JSON.stringify(rows, null, 2)}`,
    '',
    '/**',
    ' * The measured arrival-value band for a position, or null when we have no',
    ' * cell. Null is the honest answer; there is no default worth inventing.',
    ' */',
    'export function arrivalValueFor(position: string): ArrivalValueCell | null {',
    '  return ARRIVAL_VALUES.find((c) => c.position === position) ?? null',
    '}',
    '',
  ].join('\n')

  fs.writeFileSync(OUT_FILE, generated, 'utf8')
  console.log(`\nwrote ${OUT_FILE}`)
}

main().catch((err) => {
  console.error(err instanceof Abort ? `\nABORTED — ${err.message}` : `backfill failed: ${err}`)
  process.exit(1)
})
