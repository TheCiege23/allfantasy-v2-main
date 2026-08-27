/**
 * Census and dedupe of Sleeper-sourced `SportsPlayer` rows. READ-ONLY unless
 * `--write` is passed.
 *
 *   npx tsx scripts/dedupe-sleeper-player-rows.ts           # census only
 *   npx tsx scripts/dedupe-sleeper-player-rows.ts --write   # deletes the losers
 *
 * WHAT IS ACTUALLY WRONG. `SportsPlayer` is unique on `(sport, externalId,
 * source)`, and three writers have used three different `externalId` shapes
 * under `source: 'sleeper'` — the bare id, `sleeper:<id>` and `sleeper_<id>`.
 * `lib/canonical/backfillCanonical.ts` documents one production player carrying
 * all three at once. The result is the same man occupying several rows, and
 * "whichever landed last" deciding what a draft board or a player card shows.
 *
 * ⚠ THE FIX IS NOT TO REWRITE `externalId`. That was the obvious move and it is
 * wrong: `backfillCanonical` says plainly that `Player.providerIds` keeps the
 * RAW externalId because "the legacy SportsPlayer mirror looks rows up by it".
 * Normalising the column in place would break every stored reference to it.
 * The readers that matter already accept either shape — they OR on `sleeperId`
 * — and the canonical layer already strips the prefixes. The format is not the
 * harm. The DUPLICATE ROWS are.
 *
 * ⚠ IT RANKS WITH THE CANONICAL LAYER'S OWN FUNCTION. `pickBestSourceRow` is
 * imported rather than reimplemented. A second ranking that disagreed would
 * delete the row `backfillCanonical` had already built a `Player` from, and the
 * next backfill would rebuild that player from a worse row without complaint.
 *
 * ⚠ A SHARED `sleeperId` WITH DIFFERENT NAMES IS NOT A DUPLICATE. It is two
 * different people wearing one id, which is a data-integrity fault and not
 * something a dedupe gets to resolve by deleting one of them. Those groups are
 * counted, listed, and never touched.
 *
 * ⚠ THIS TALKS TO PRODUCTION. `.env.local` in this repo IS the production
 * database. Run the census first and read it.
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

import { pickBestSourceRow, type SourcePlayer } from '../lib/canonical/sourceRowRanking'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')
const SPORT = 'NFL'
const SOURCE = 'sleeper'

/** Same separators `normalizeProviderPlayerId` handles, for the census only. */
function shapeOf(externalId: string, sleeperId: string | null): string {
  const lower = externalId.toLowerCase()
  if (lower.startsWith('sleeper:')) return 'sleeper:<id>'
  if (lower.startsWith('sleeper_')) return 'sleeper_<id>'
  if (lower.startsWith('sleeper-')) return 'sleeper-<id>'
  if (sleeperId && externalId === sleeperId) return 'bare <id>'
  return 'other'
}

/** Case and whitespace only — anything more would be guessing at nicknames. */
function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Sleeper ids where a human looked at the two names and confirmed one player.
 *
 * ⚠ AN ALLOWLIST, NOT A LOOSER RULE. The obvious alternative was to widen
 * `sameName` to forgive punctuation and nicknames — "A.J."/"AJ", "Matt"/"Matthew".
 * That trades the one protection this script has for four rows: the rule exists
 * to stop two DIFFERENT people who share an id from being silently merged, and a
 * rule that forgives nicknames cannot tell "Matt Hibner / Matthew Hibner" from a
 * genuine collision between two men called Matt and Matthew.
 *
 * So the rule stays strict and the exceptions are named, one line each, with the
 * pair written down so the next reader can check the judgement rather than trust
 * it. Reviewed and approved by Guap on 2026-08-27.
 */
const REVIEWED_NAME_VARIANTS = new Map<string, string>([
  ['13324', 'Matthew Hibner / Matt Hibner'],
  ['13384', 'A.J. Haulcy / AJ Haulcy'],
  ['8861', 'Irvin Charles / Irv Charles'],
  ['13455', 'T.J. Parker / TJ Parker'],
])

async function main() {
  console.log(`mode: ${WRITE ? 'WRITE' : 'census only'}`)

  const rows = (await prisma.sportsPlayer.findMany({
    where: { sport: SPORT, source: SOURCE },
    select: {
      id: true, name: true, sport: true, position: true, team: true,
      externalId: true, source: true, sleeperId: true, imageUrl: true,
      height: true, weight: true, status: true, fetchedAt: true, expiresAt: true,
    },
  })) as SourcePlayer[]

  console.log(`\n${rows.length} rows with source='${SOURCE}' in ${SPORT}`)

  const shapes = new Map<string, number>()
  for (const r of rows) {
    const k = shapeOf(r.externalId, r.sleeperId)
    shapes.set(k, (shapes.get(k) ?? 0) + 1)
  }
  console.log('\nexternalId shapes:')
  for (const [k, n] of [...shapes].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(14)} ${n}`)
  }

  const noSleeperId = rows.filter((r) => !r.sleeperId)
  console.log(`\nrows with no sleeperId: ${noSleeperId.length} (left alone — duplication cannot be proven)`)

  const byPlayer = new Map<string, SourcePlayer[]>()
  for (const r of rows) {
    if (!r.sleeperId) continue
    const list = byPlayer.get(r.sleeperId) ?? []
    list.push(r)
    byPlayer.set(r.sleeperId, list)
  }

  const duplicates: Array<{ sleeperId: string; keep: SourcePlayer; drop: SourcePlayer[] }> = []
  const conflicts: Array<{ sleeperId: string; names: string[] }> = []

  for (const [sleeperId, group] of byPlayer) {
    if (group.length < 2) continue
    const first = group[0]!
    if (!group.every((r) => sameName(r.name, first.name))) {
      const reviewed = REVIEWED_NAME_VARIANTS.get(sleeperId)
      if (!reviewed) {
        conflicts.push({ sleeperId, names: [...new Set(group.map((r) => r.name))] })
        continue
      }
      /* Named above, checked by a person, and printed again here so a run that
         collapses one of these says so out loud rather than doing it quietly. */
      console.log(`     reviewed variant, collapsing: ${sleeperId}  ${reviewed}`)
    }
    const keep = pickBestSourceRow(group)
    duplicates.push({ sleeperId, keep, drop: group.filter((r) => r.id !== keep.id) })
  }

  const dropCount = duplicates.reduce((n, d) => n + d.drop.length, 0)
  console.log(`\nplayers with more than one row: ${duplicates.length + conflicts.length}`)
  console.log(`  duplicates safe to collapse: ${duplicates.length} (${dropCount} rows would be deleted)`)
  console.log(`  ⚠ same sleeperId, DIFFERENT names: ${conflicts.length} (never touched)`)

  for (const c of conflicts.slice(0, 10)) {
    console.log(`     ${c.sleeperId}: ${c.names.join(' | ')}`)
  }
  if (conflicts.length > 10) console.log(`     …and ${conflicts.length - 10} more`)

  for (const d of duplicates.slice(0, 10)) {
    const keepShape = shapeOf(d.keep.externalId, d.keep.sleeperId)
    const dropShapes = d.drop.map((r) => shapeOf(r.externalId, r.sleeperId)).join(', ')
    console.log(`     ${d.keep.name}: keep ${keepShape}, drop ${dropShapes}`)
  }
  if (duplicates.length > 10) console.log(`     …and ${duplicates.length - 10} more`)

  if (!WRITE) {
    console.log('\ncensus only — nothing written. Re-run with --write to collapse the duplicates.')
    return
  }
  if (dropCount === 0) {
    console.log('\nnothing to collapse.')
    return
  }

  /*
   * Deleting is safe here in a way it usually is not: nothing in the schema
   * declares a relation to `SportsPlayer`, so there is no cascade and no
   * orphan. The canonical `Player` table is built FROM these rows rather than
   * pointing at them, and it is rebuilt from whichever rows remain.
   */
  const ids = duplicates.flatMap((d) => d.drop.map((r) => r.id))
  let deleted = 0
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200)
    const res = await prisma.sportsPlayer.deleteMany({ where: { id: { in: batch } } })
    deleted += res.count
  }
  console.log(`\ndeleted ${deleted} duplicate rows, kept one per player.`)
  console.log('Run backfillCanonical afterwards so the canonical layer reflects the collapsed set.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
