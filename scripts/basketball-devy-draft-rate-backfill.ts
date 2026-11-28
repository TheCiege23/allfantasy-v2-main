/**
 * Measure P(drafted | recruiting rank band, position) and the NBA draft slot given drafted, for college
 * basketball, and write lib/devy/basketballDraftRates.generated.ts. The basketball mirror of
 * scripts/devy-draft-rate-backfill.ts (contracts/cbbd/GAPS.md B-02, B-05).
 *
 * ⚠ READS STORED ROWS ONLY. It makes no provider call: the recruiting classes come from `cbbd:recruits:v1:<year>`
 * and the drafts from `cbbd:draft-history:v1:<year>` (scripts/backfill-cbbd-draft-history.ts). It needs a
 * DATABASE_URL to READ them, and writes nothing to the database — its only output is the generated file.
 *
 * ⚠ ABORTS RATHER THAN EMITTING PARTIAL RATES, like football's. A measured class whose five-draft outcome window
 * is not fully stored would undercount every cell invisibly. A recruit -> pick join below `--min-join` (default
 * 0.5 of the window's college picks with an athlete id) also aborts: a low join is a broken id link, and the
 * rates would be a statement about the join rather than about basketball.
 *
 * With nothing stored it prints why and leaves the committed EMPTY table alone (exit 1).
 *
 * Usage:
 *   node --require ./scripts/_audit-preload.cjs --import tsx scripts/basketball-devy-draft-rate-backfill.ts [--dry-run] [--min-join=0.5]
 */
import fs from 'node:fs'
import path from 'node:path'

import {
  BasketballMeasurementAbort,
  BASKETBALL_MIN_DRAFTED,
  BASKETBALL_MIN_RECRUITS,
  measureBasketballDraftRates,
  OUTCOME_WINDOW_YEARS,
  renderBasketballDraftRatesFile,
} from '../lib/devy/basketballDraftRates'
import { lastFinalDraftYear, readDraftHistory } from '../lib/devy/cbbdDraftHistoryIngest'
import { readRecruitClasses } from '../lib/devy/cbbdRecruitsStore'

const OUT_FILE = path.resolve(process.cwd(), 'lib/devy/basketballDraftRates.generated.ts')
const EARLIEST_CLASS = 2000

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const minJoinArg = process.argv.find((a) => a.startsWith('--min-join='))?.split('=')[1]
  const minJoin = minJoinArg == null ? 0.5 : Number(minJoinArg)
  if (!Number.isFinite(minJoin) || minJoin < 0 || minJoin > 1) throw new BasketballMeasurementAbort('--min-join must be between 0 and 1')

  const { prisma } = await import('../lib/prisma')
  try {
    // A class is measurable once its last outcome draft (C+5) has closed.
    const newestClass = lastFinalDraftYear(new Date()) - Math.max(...OUTCOME_WINDOW_YEARS)
    const candidateClasses: number[] = []
    for (let c = EARLIEST_CLASS; c <= newestClass; c++) candidateClasses.push(c)
    const classes = await readRecruitClasses(candidateClasses, prisma as never)
    console.log(`stored recruiting classes with a closed outcome window: ${[...classes.keys()].sort().join(', ') || 'none'}`)
    if (classes.size === 0) {
      throw new BasketballMeasurementAbort(
        'no stored basketball recruiting classes. The recruiting feed is not built yet: capture it first ' +
          '(contracts/cbbd/scripts/probe.sh recruiting <YEAR>, GAPS B-04). The committed table stays EMPTY.',
      )
    }
    const draftYears = new Set<number>()
    for (const c of classes.keys()) for (const d of OUTCOME_WINDOW_YEARS) draftYears.add(c + d)
    const drafts = await readDraftHistory([...draftYears], prisma as never)
    console.log(`stored NBA drafts needed: ${[...draftYears].sort().join(', ')}; found ${drafts.size}`)

    const measured = measureBasketballDraftRates({ classes, drafts })
    const { provenance, cells } = measured
    console.log(`\nposition rank      recruits drafted   rate   (prices only at >=${BASKETBALL_MIN_RECRUITS} recruits and >=${BASKETBALL_MIN_DRAFTED} drafted)`)
    for (const c of cells) {
      const ok = c.recruits >= BASKETBALL_MIN_RECRUITS && c.drafted >= BASKETBALL_MIN_DRAFTED
      console.log(
        `${c.position.padEnd(9)}${`${c.rankMin}-${c.rankMax - 1}`.padEnd(10)}${String(c.recruits).padStart(8)}${String(c.drafted).padStart(8)}` +
          `${(c.rate * 100).toFixed(1).padStart(7)}%${ok ? '' : '   (below min-n: will not price)'}`,
      )
    }
    console.log(`\noverall: ${provenance.totalDrafted}/${provenance.totalRecruits}`)
    const join = provenance.join!
    console.log(`join: ${join.matchedToRecruit}/${join.collegePicksInWindow} college picks matched a stored recruit (${(join.matchRate * 100).toFixed(1)}%)`)
    if (join.matchRate < minJoin) {
      throw new BasketballMeasurementAbort(`the recruit -> pick join matched ${(join.matchRate * 100).toFixed(1)}%, under --min-join ${minJoin}. Fix the athlete-id link before trusting any rate.`)
    }

    if (dryRun) {
      console.log('\n--dry-run: nothing written')
      return
    }
    fs.writeFileSync(OUT_FILE, renderBasketballDraftRatesFile(measured), 'utf8')
    console.log(`\nwrote ${OUT_FILE}`)
  } finally {
    await prisma.$disconnect().catch(() => undefined)
  }
}

main().catch((err) => {
  console.error(err instanceof BasketballMeasurementAbort ? `\nNOT MEASURED — ${err.message}` : `measurement failed: ${err}`)
  process.exitCode = 1
})
