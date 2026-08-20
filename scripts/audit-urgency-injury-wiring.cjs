#!/usr/bin/env node
/**
 * READ-ONLY: before/after measurement for the Slice 18 injury wiring.
 *
 * ACCEPTANCE (AF_HANDOFF_2026-08-10): the count of players able to reach
 * `critical`/`high` urgency must move substantially off "1 league-wide Out".
 * Urgency severity is driven by the portfolio's injury.status:
 *   unavailable = out / ir / suspended
 *   risky       = doubtful
 *   watch       = questionable / day_to_day
 *
 * BEFORE simulates the old path: SportsPlayerRecord.injuryStatus through the
 * old RAW_STATUS_MAP + availability-category coercion (including the NA →
 * unavailable → 'out' false positive).
 *
 * AFTER simulates the new path: live sportsInjury rows (the read port's
 * source) with parsed designations, plus the genuine-token-only fallback.
 *
 * No writes. Usage: node scripts/audit-urgency-injury-wiring.cjs [NFL]
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// --- old mapping (what crossLeaguePlayerPortfolio.ts:123 used to do) ---
const OLD_RAW = {
  ir: 'ir', o: 'out', out: 'out', sus: 'suspended', suspended: 'suspended',
  d: 'doubtful', doubtful: 'doubtful', q: 'questionable', questionable: 'questionable',
  dtd: 'day_to_day', day_to_day: 'day_to_day', 'day-to-day': 'day_to_day',
  active: 'healthy', healthy: 'healthy', act: 'healthy',
}
const AVAILABLE = new Set(['active', 'healthy', 'act'])
const UNCERTAIN = new Set(['q', 'questionable', 'd', 'doubtful'])
const UNAVAILABLE = new Set(['o', 'out', 'ir', 'pup', 'sus', 'suspended', 'na', 'inactive', 'nfi', 'cov'])
function oldStatus(raw) {
  const key = String(raw ?? '').trim().toLowerCase()
  if (OLD_RAW[key]) return OLD_RAW[key]
  if (AVAILABLE.has(key)) return 'healthy'
  if (UNCERTAIN.has(key)) return 'questionable'
  if (UNAVAILABLE.has(key)) return 'out'
  return 'unknown'
}

// --- new mappings (Slice 18) ---
const DESIGNATION = {
  out: 'out', doubtful: 'doubtful', questionable: 'questionable', probable: 'healthy',
  ir: 'ir', 'day-to-day': 'day_to_day', day_to_day: 'day_to_day', dtd: 'day_to_day',
  sus: 'suspended', suspended: 'suspended', suspension: 'suspended',
}
const FALLBACK = {
  ir: 'ir', pup: 'ir', o: 'out', out: 'out', sus: 'suspended', suspended: 'suspended',
  suspension: 'suspended', d: 'doubtful', doubtful: 'doubtful', q: 'questionable',
  questionable: 'questionable', dtd: 'day_to_day', day_to_day: 'day_to_day', 'day-to-day': 'day_to_day',
}

function severity(status) {
  if (status === 'out' || status === 'ir' || status === 'suspended') return 'unavailable'
  if (status === 'doubtful') return 'risky'
  if (status === 'questionable' || status === 'day_to_day') return 'watch'
  return 'none'
}

function tally(label, statuses) {
  const bySeverity = { unavailable: 0, risky: 0, watch: 0, none: 0 }
  const byStatus = {}
  for (const s of statuses) {
    bySeverity[severity(s)]++
    byStatus[s] = (byStatus[s] || 0) + 1
  }
  console.log(`\n--- ${label} ---`)
  console.log(`  unavailable (drives critical/high when starting): ${bySeverity.unavailable}`)
  console.log(`  risky (doubtful):                                 ${bySeverity.risky}`)
  console.log(`  watch (questionable/day-to-day):                  ${bySeverity.watch}`)
  for (const [k, v] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(14)} ${v}`)
  }
  return bySeverity
}

async function main() {
  const sport = process.argv[2] || 'NFL'
  const now = new Date()
  console.log(`\n=== urgency injury wiring — before/after — ${sport} ===`)

  // BEFORE: every player-record token, pushed through the old mapping.
  const records = await prisma.sportsPlayerRecord.findMany({
    where: { sport, injuryStatus: { not: null } },
    select: { injuryStatus: true },
  })
  const before = tally(
    'BEFORE (SportsPlayerRecord.injuryStatus via old map + availability coercion)',
    records.map((r) => oldStatus(r.injuryStatus)),
  )

  // AFTER primary: live RI injury rows through the designation map.
  const injuries = await prisma.sportsInjury.findMany({
    where: { sport, expiresAt: { gt: now } },
    select: { status: true, fetchedAt: true },
  })
  const staleCutoff = now.getTime() - 36 * 3_600_000
  const staleCount = injuries.filter((r) => r.fetchedAt.getTime() < staleCutoff).length
  const after = tally(
    'AFTER primary (live sportsInjury rows via designation map)',
    injuries.map((r) => {
      const key = String(r.status ?? '').trim().toLowerCase()
      return r.status == null ? 'unknown' : (DESIGNATION[key] ?? 'unknown')
    }),
  )
  console.log(`  (of these, ${staleCount} rows are >36h old and would render FLAGGED stale)`)

  // AFTER fallback: genuine record tokens only (roster tokens ignored).
  tally(
    'AFTER fallback (record tokens, genuine-injury-only; roster tokens ignored)',
    records
      .map((r) => FALLBACK[String(r.injuryStatus).trim().toLowerCase()] ?? null)
      .filter(Boolean),
  )

  console.log('\n--- verdict ---')
  const b = before.unavailable
  const a = after.unavailable
  console.log(`  players that can drive critical/high (unavailable): ${b} -> ${a}`)
  if (a > Math.max(5, b)) {
    console.log('  PASS: urgency now has real designations to fire on.')
  } else if (a <= 1) {
    console.log('  FAIL: still effectively blind — the wiring did not take. Check that')
    console.log('  resolveInjuryFacts returns rows (expiresAt TTL, sport casing, name matching).')
  } else {
    console.log('  INCONCLUSIVE: some movement, but small. Inspect the designation vocabulary above')
    console.log('  against DESIGNATION_TO_INJURY_STATUS in crossLeaguePlayerPortfolio.ts.')
  }
  console.log('\n  NOTE: BEFORE counts include false positives (NA/INACT coerced to out via')
  console.log('  availability category) — a large BEFORE unavailable count is contamination,')
  console.log('  not signal. The honest comparison is BEFORE genuine tokens (~429) vs AFTER.')
}

main()
  .catch((e) => {
    console.error('audit failed:', e.message)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
