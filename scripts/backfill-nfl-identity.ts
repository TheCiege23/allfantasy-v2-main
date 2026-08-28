/**
 * Phase 3, strong tier: pair NFL Rolling Insights ids to Sleeper ids in `PlayerIdentityMap`.
 *
 * ⚠ WRITES TO WHATEVER `DATABASE_URL` POINTS AT. Requires `--write`; without it this is a dry run.
 *
 * ⚠ STRONG TIER ONLY, AND THE OTHER TIERS ARE REFUSED ON PURPOSE. A pair is written only when the
 * normalized name is UNIQUE in the Sleeper NFL set, the position FAMILY agrees, and BOTH sides
 * state a team and those teams are equal. Measured against the 1,890 pairs the map already
 * asserts, that rule is 99.9% precise (1,490 of 1,492). The weak tier — team unknown on one side —
 * measured 100% on 200 cases but is not run here. The narrowed-ambiguous tier measured 86.7% and
 * must never be run: a wrong pairing is invisible once written and `sleeperId @unique` cannot
 * catch it, because the wrong id is still a free id.
 *
 * ⚠ `normalizedName` IS PLAIN LOWERCASE HERE, NOT `normalizePlayerName`. Measured on the 1,933
 * existing NFL rows: `normalizedName === canonicalName.trim().toLowerCase()` holds for 100% of
 * them, while `normalizePlayerName` from `lib/team-abbrev` agrees on only 93.2% — it strips
 * suffixes and punctuation the stored rows keep ("david sills v", "a.j. terrell", "james pearce
 * jr."). Writing that normalizer's output into an indexed column shared with 1,933 rows that use
 * the other convention would put half the table out of reach of the other half's lookups.
 *
 * ⚠ ROLLING INSIGHTS HOLDS DUPLICATE ROWS FOR ONE PLAYER. "Harold Landry" and "Harold Landry Iii"
 * are separate RI ids that both resolve to Sleeper 5030. The `sleeperId @unique` constraint stops
 * the second, and that is the correct outcome — it is skipped and counted, never forced.
 */

import { PrismaClient } from '@prisma/client'

import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

const prisma = new PrismaClient()
const WRITE = process.argv.includes('--write')
/*
 * Which tier to write. STRONG requires both sides to state a team and agree; WEAK accepts a
 * unique name and matching position family when one side does not state a team. Weak measured
 * 200/200 against pre-existing ground truth — but on a 200-case sample, so the tier is a
 * deliberate choice at the command line rather than a default.
 */
const TIER: 'strong' | 'weak' = process.argv.includes('--tier=weak') ? 'weak' : 'strong'

const normName = (s: string | null | undefined) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/(jr|sr|ii|iii|iv|v)$/, '')

const tm = (t: string | null | undefined) => normalizeTeamAbbrev(t) ?? null

/** Position FAMILIES, because the two feeds disagree on labels for the same job (RI `DL`, Sleeper `DE`). */
const FAMILY: Record<string, string> = {
  DE: 'DL', DT: 'DL', NT: 'DL', DL: 'DL', EDGE: 'DL',
  LB: 'LB', OLB: 'LB', ILB: 'LB', MLB: 'LB',
  CB: 'DB', S: 'DB', FS: 'DB', SS: 'DB', DB: 'DB',
  OT: 'OL', OG: 'OL', C: 'OL', G: 'OL', T: 'OL', OL: 'OL', LS: 'OL',
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', K: 'K', P: 'P',
}
const fam = (p: string | null | undefined) =>
  FAMILY[String(p ?? '').toUpperCase().trim()] ?? String(p ?? '').toUpperCase().trim()

async function main() {
  console.log(`${WRITE ? '=== WRITE MODE ===' : '=== DRY RUN (pass --write to apply) ==='}  tier=${TIER}`)

  const ri = await prisma.sportsPlayer.findMany({
    where: { sport: 'NFL', source: 'rolling_insights' },
    select: { externalId: true, sleeperId: true, name: true, team: true, position: true },
  })
  const mapRows = await prisma.playerIdentityMap.findMany({
    select: { id: true, sport: true, sleeperId: true, rollingInsightsId: true },
  })
  const alreadyPaired = new Set(
    mapRows.filter((m) => m.sport === 'NFL' && m.sleeperId && m.rollingInsightsId).map((m) => m.rollingInsightsId as string),
  )
  const unpaired = ri.filter((r) => !r.sleeperId && !alreadyPaired.has(r.externalId))

  const sleeperRows = await prisma.sportsPlayer.findMany({
    where: { sport: 'NFL', source: 'sleeper' },
    select: { sleeperId: true, name: true, team: true, position: true },
  })
  const byName = new Map<string, typeof sleeperRows>()
  for (const s of sleeperRows) {
    const k = normName(s.name)
    if (!k) continue
    const a = byName.get(k) ?? []
    a.push(s)
    byName.set(k, a)
  }

  const byRi = new Map(mapRows.filter((m) => m.rollingInsightsId).map((m) => [`${m.sport}|${m.rollingInsightsId}`, m]))
  const bySleeper = new Map(mapRows.filter((m) => m.sleeperId).map((m) => [m.sleeperId as string, m]))

  const seenSleeper = new Set<string>()
  const seenRi = new Set<string>()
  let created = 0, updated = 0, skippedTaken = 0, skippedDupBatch = 0, failed = 0

  for (const r of unpaired) {
    const cands = byName.get(normName(r.name))
    if (!cands || cands.length !== 1) continue
    const c = cands[0]
    if (!c.sleeperId) continue
    if (fam(c.position) !== fam(r.position)) continue
    const rt = tm(r.team)
    const ct = tm(c.team)
    const bothTeamsKnown = rt !== null && ct !== null
    if (bothTeamsKnown) {
      if (rt !== ct) continue
      if (TIER !== 'strong' && TIER !== 'weak') continue
    } else if (TIER === 'strong') {
      continue // strong requires a stated team on both sides
    }

    if (seenSleeper.has(c.sleeperId) || seenRi.has(r.externalId)) { skippedDupBatch++; continue }
    seenSleeper.add(c.sleeperId)
    seenRi.add(r.externalId)

    const riRow = byRi.get(`NFL|${r.externalId}`)
    const slRow = bySleeper.get(c.sleeperId)
    if (slRow && slRow.rollingInsightsId && slRow.rollingInsightsId !== r.externalId) { skippedTaken++; continue }

    const canonicalName = r.name.trim()
    const data = {
      canonicalName,
      normalizedName: canonicalName.toLowerCase(),
      position: r.position ?? null,
      currentTeam: rt ?? ct,
      sport: 'NFL',
    }

    try {
      if (riRow) {
        if (WRITE) await prisma.playerIdentityMap.update({ where: { id: riRow.id }, data: { sleeperId: c.sleeperId } })
        updated++
      } else if (slRow) {
        if (WRITE) await prisma.playerIdentityMap.update({ where: { id: slRow.id }, data: { rollingInsightsId: r.externalId } })
        updated++
      } else {
        if (WRITE) await prisma.playerIdentityMap.create({ data: { ...data, sleeperId: c.sleeperId, rollingInsightsId: r.externalId } })
        created++
      }
    } catch (e) {
      // A unique-constraint loss is a duplicate RI row racing for one Sleeper id; count, never force.
      failed++
      if (failed <= 5) console.warn(`  skipped ${r.externalId} -> ${c.sleeperId} ("${r.name}"): ${String(e).split('\n')[0]}`)
    }
  }

  console.log(`\n  created            : ${created}`)
  console.log(`  updated            : ${updated}`)
  console.log(`  skipped, id taken  : ${skippedTaken}`)
  console.log(`  skipped, dup batch : ${skippedDupBatch}`)
  console.log(`  failed on write    : ${failed}`)
  console.log(`  ---- total applied  : ${WRITE ? created + updated : 0}`)
  await prisma.$disconnect()
}

void main()
