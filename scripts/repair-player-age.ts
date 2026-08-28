/**
 * Repair `SportsPlayer.age` wherever it holds something that is not an age.
 *
 * ⚠ WRITES TO WHATEVER `DATABASE_URL` POINTS AT. Requires `--write`; without it this is a dry run.
 *
 * The ingest stored the vendor's `age` with a generic `intOf`, which strips separators and keeps
 * the digits, so a birthdate became a plausible-looking integer: "2/9/1996" -> 291996. Measured on
 * production 2026-08-28, ALL 13,763 RI rows carrying an age held such a value — 9,550 NFL and
 * 4,213 SOCCER, against 0.0% impossible for Sleeper.
 *
 * ⚠ THE WRITER IS FIXED FIRST, OR THIS UNDOES ITSELF ON THE NEXT SYNC. The same helper now runs
 * inside `rollingInsightsTeamsPlayers`, so repaired rows stay repaired. Running this against an
 * unfixed ingest would buy one clean read and nothing more.
 *
 * ⚠ ±1 YEAR, AND ONLY THE YEAR. Day and month are unrecoverable from the stored digits. Validated
 * against Sleeper's own age across 3,091 known-good pairs: 93.9% land within a year, with a
 * bimodal 0/1 split that is the signature of a correct birth year. A row this cannot resolve is
 * set to NULL, not left holding a number that means nothing.
 */

import { PrismaClient } from '@prisma/client'

import { coercePlayerAge } from '@/lib/sports-data/playerAge'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')
const BATCH = 500

async function main() {
  console.log(WRITE ? '=== WRITE MODE ===' : '=== DRY RUN (pass --write to apply) ===')

  /*
   * Every source, not just Rolling Insights. RI was the total failure — 13,763 of 13,763 — but
   * TheSportsDB admits 31 impossible ages through a `years < 120` bound, api_football holds a
   * bare year (2025), and Sleeper has two. Same column, same question: is this a plausible age.
   */
  const rows = await prisma.sportsPlayer.findMany({
    where: { age: { not: null } },
    select: { id: true, sport: true, source: true, age: true, name: true },
  })
  console.log(`rows with a non-null age: ${rows.length}`)

  const repairs: { id: string; from: number; to: number | null }[] = []
  let alreadySane = 0
  for (const r of rows) {
    const current = r.age as number
    if (current >= 14 && current <= 60) { alreadySane++; continue }
    repairs.push({ id: r.id, from: current, to: coercePlayerAge(current) })
  }
  const resolvable = repairs.filter((x) => x.to !== null)
  const unresolvable = repairs.filter((x) => x.to === null)
  const bySource = new Map<string, number>()
  for (const r of rows) {
    const a = r.age as number
    if (a >= 14 && a <= 60) continue
    bySource.set(r.source ?? 'null', (bySource.get(r.source ?? 'null') ?? 0) + 1)
  }
  console.log(`  impossible by source:`, [...bySource].sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join('  ') || 'none')
  console.log(`  already a sane age, untouched : ${alreadySane}`)
  console.log(`  impossible, recoverable       : ${resolvable.length}`)
  console.log(`  impossible, NOT recoverable   : ${unresolvable.length}  -> set to NULL`)

  const dist = new Map<number, number>()
  for (const x of resolvable) dist.set(x.to as number, (dist.get(x.to as number) ?? 0) + 1)
  const ages = [...dist.keys()].sort((a, b) => a - b)
  console.log(
    ages.length
      ? `  resulting age range: ${ages[0]}..${ages[ages.length - 1]}`
      : '  resulting age range: n/a (nothing recoverable this run)',
  )
  console.log('  samples:', repairs.slice(0, 6).map((x) => `${x.from}->${x.to}`).join('  '))

  if (!WRITE) { await prisma.$disconnect(); return }

  let done = 0
  // Grouped so identical ages go in one updateMany rather than 13,763 round trips.
  for (const [age, _n] of dist) {
    const ids = resolvable.filter((x) => x.to === age).map((x) => x.id)
    for (let i = 0; i < ids.length; i += BATCH) {
      const slice = ids.slice(i, i + BATCH)
      const res = await prisma.sportsPlayer.updateMany({ where: { id: { in: slice } }, data: { age } })
      done += res.count
    }
  }
  let nulled = 0
  for (let i = 0; i < unresolvable.length; i += BATCH) {
    const slice = unresolvable.slice(i, i + BATCH).map((x) => x.id)
    const res = await prisma.sportsPlayer.updateMany({ where: { id: { in: slice } }, data: { age: null } })
    nulled += res.count
  }
  console.log(`\n  repaired: ${done}`)
  console.log(`  nulled  : ${nulled}`)
  await prisma.$disconnect()
}

void main()
