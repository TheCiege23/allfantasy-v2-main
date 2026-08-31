/**
 * DRY RUN. Reports exactly what widening the NCAAF identity registry from
 * `SportsPlayer` would insert, and writes nothing.
 *
 * 🛑 THIS SCRIPT IS THE SHAPE OF THE POOL. IT IS NOT THE AUTHORITATIVE COUNT.
 * `widenNcaafIdentities({ dryRun: true })` in
 * `lib/devy/ingestNcaafIdentitiesFromSportsPlayer.ts` is — and the two disagree
 * on purpose:
 *
 *   this script  44,692 pairs   normalizes in SQL
 *   the writer   42,546 pairs   normalizes with `normalizePlayerName`
 *
 * The writer uses the one normalizer the resolver also uses, so its number is
 * what would actually be written and read back. This script reimplements the
 * rule in SQL to let Postgres do the grouping, and a comparison of the two on
 * 500 real rows found 36 disagreements (7.2%) — generational suffixes and
 * apostrophes: `Danny Lockhart Jr.` and `Patrick O'Brien`.
 *
 * That gap is why the WRITER does not normalize in SQL at all. It is tolerated
 * HERE because this script only characterises the pool — junk rate, staleness,
 * provenance, collision structure — and none of those conclusions move by 5%.
 * Do not quote this file's totals as the insert size.
 *
 * 🛑 THIS SCRIPT CONTAINS NO WRITE CALL, AND THAT IS THE POINT. `PlayerIdentityMap`
 * is the canonical table the whole app resolves players against — `AFProjectionSnapshot.playerId`
 * lands on it, the Fantrax and CFBD bridges hang off it, and an insert of this size
 * is not cheaply reversible. So the decision to write is a human one, and this
 * exists to make that decision on evidence rather than on a count.
 *
 * ⚠ IT READS PRODUCTION. Importing `@prisma/client` populates `process.env` from
 * `.env` on import, so this connects to whatever `DATABASE_URL` names there —
 * which in this repo is production. That is acceptable ONLY because every query
 * below is a read. If you add a query, keep it that way.
 *
 *   npx tsx scripts/audit-ncaaf-identity-widening.ts
 *
 * ⚠ `scripts/` IS EXCLUDED FROM tsconfig, so a typecheck of the repo says nothing
 * about this file.
 */

import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
dotenv.config({ path: '.env' })

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * The one normalization, used on BOTH sides of every comparison.
 *
 * ⚠ IT MUST MATCH `normalizePlayerName`'s OUTPUT for a name that is already in
 * "First Last" order — lowercase, letters and spaces only, collapsed. If the two
 * drift, this audit reports a candidate pool the real writer would never produce,
 * which is a worse failure than reporting nothing.
 */
/*
 * ⚠ `[[:space:]]+` RATHER THAN `\s+`, DELIBERATELY. A backslash here has to
 * survive every layer between wherever the query is written and Postgres, and
 * when one layer eats it the pattern silently becomes `s+` — a valid regex
 * matching the LETTER s. That strips every s out of every name, compares the
 * wreckage against the registry, and returns a perfectly plausible number.
 *
 * It happened twice while this script was being written: two hand-written probes
 * reported 48,074 candidates against this script's 38,976, and a roster estimate
 * of "+7 connected" that is really +17. Both were wrong in the safe-looking
 * direction and neither threw. The POSIX class needs no escaping and cannot fail
 * that way, which is why it is used here even though `\s+` is shorter.
 */
const NORM = `trim(regexp_replace(lower(regexp_replace(%C%, '[^a-zA-Z ]', '', 'g')), '[[:space:]]+', ' ', 'g'))`
const n = (col: string) => NORM.replace('%C%', col)

type Row = Record<string, unknown>

const num = (v: unknown) => Number(v ?? 0)
const pct = (a: number, b: number) => (b === 0 ? '  n/a' : `${((a / b) * 100).toFixed(1)}%`)

async function q<T = Row>(sql: string, ...args: unknown[]): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql, ...args)
}

function head(title: string) {
  console.log(`\n${'─'.repeat(72)}\n${title}\n${'─'.repeat(72)}`)
}

async function main() {
  console.log('DRY RUN — this script writes nothing.\n')

  /* ── The pool ────────────────────────────────────────────────────────── */
  head('1. The candidate pool')

  const totals = (
    await q(`
    SELECT
      (SELECT count(*) FROM "SportsPlayer" WHERE sport = 'NCAAF')                      AS sp_rows,
      (SELECT count(DISTINCT ${n('sp.name')}) FROM "SportsPlayer" sp WHERE sp.sport='NCAAF') AS sp_names,
      (SELECT count(*) FROM "PlayerIdentityMap" WHERE sport = 'NCAAF')                 AS pim_rows
  `)
  )[0]!

  console.log(`  SportsPlayer NCAAF rows            ${num(totals.sp_rows).toLocaleString()}`)
  console.log(`  ...distinct normalized names       ${num(totals.sp_names).toLocaleString()}`)
  console.log(`  PlayerIdentityMap NCAAF rows       ${num(totals.pim_rows).toLocaleString()}`)

  /*
   * Candidates: a distinct normalized name present in SportsPlayer and absent
   * from the NCAAF registry. Built once into a temp view expression reused below
   * so every section describes the SAME pool.
   */
  const CANDIDATES = `
    SELECT ${n('sp.name')} AS norm,
           min(sp.name)        AS sample_name,
           count(*)            AS row_count,
           count(sp.position)  AS with_position,
           count(sp.team)      AS with_team,
           count(sp.college)   AS with_college,
           count(sp."imageUrl") AS with_image,
           count(sp.dob)       AS with_dob,
           max(sp."expiresAt") AS newest_expiry
    FROM "SportsPlayer" sp
    WHERE sp.sport = 'NCAAF'
      AND ${n('sp.name')} <> ''
      AND NOT EXISTS (
        SELECT 1 FROM "PlayerIdentityMap" p
        WHERE p.sport = 'NCAAF' AND p."normalizedName" = ${n('sp.name')}
      )
    GROUP BY ${n('sp.name')}`

  /*
   * ⚠ PRINT THE SQL ON DEMAND, because an audit whose number cannot be
   * reproduced by hand is not evidence. Two hand-written variants of this query
   * disagreed with it by 9,098 rows; the only way to settle that was to compare
   * against the string actually sent, not against a retyping of it.
   */
  if (process.env.AUDIT_PRINT_SQL === '1') {
    console.log('\n--- candidate SQL, verbatim ---')
    console.log(CANDIDATES)
    console.log('--- end ---\n')
  }

  const poolCount = num(
    (await q(`SELECT count(*) AS c FROM (${CANDIDATES}) q`))[0]!.c,
  )
  console.log(`\n  WOULD INSERT (distinct names)      ${poolCount.toLocaleString()}`)
  console.log(
    `  registry would go                  ${num(totals.pim_rows).toLocaleString()} → ${(
      num(totals.pim_rows) + poolCount
    ).toLocaleString()}`,
  )

  /* ── Quality ─────────────────────────────────────────────────────────── */
  head('2. Is a candidate a plausible person?')

  const shape = (
    await q(`
    SELECT
      count(*) FILTER (WHERE norm NOT LIKE '% %')                  AS single_token,
      count(*) FILTER (WHERE length(norm) < 5)                     AS very_short,
      count(*) FILTER (WHERE lower(sample_name) ~ '(team|defense|special teams|d/st)') AS team_shaped,
      count(*) FILTER (WHERE sample_name ~ '[0-9]')                AS has_digits,
      count(*) FILTER (WHERE array_length(string_to_array(norm,' '),1) > 4) AS very_many_words,
      count(*)                                                     AS total
    FROM (${CANDIDATES}) q
  `)
  )[0]!

  const total = num(shape.total)
  const row = (label: string, v: unknown) =>
    console.log(`  ${label.padEnd(34)} ${num(v).toLocaleString().padStart(8)}   ${pct(num(v), total)}`)

  row('single token (no space)', shape.single_token)
  row('shorter than 5 chars', shape.very_short)
  row('team/defense shaped', shape.team_shaped)
  row('contains a digit', shape.has_digits)
  row('more than 4 words', shape.very_many_words)

  console.log('\n  ⚠ These overlap. The union is what a writer should refuse:')
  const junk = num(
    (
      await q(`
      SELECT count(*) AS c FROM (${CANDIDATES}) q
      WHERE norm NOT LIKE '% %'
         OR length(norm) < 5
         OR lower(sample_name) ~ '(team|defense|special teams|d/st)'
         OR sample_name ~ '[0-9]'
    `)
    )[0]!.c,
  )
  console.log(`  ${'union of the above'.padEnd(34)} ${junk.toLocaleString().padStart(8)}   ${pct(junk, total)}`)
  console.log(`  ${'→ clean candidates'.padEnd(34)} ${(total - junk).toLocaleString().padStart(8)}   ${pct(total - junk, total)}`)

  /* ── Staleness ───────────────────────────────────────────────────────── */
  head('3. Are these rows current, or expired cache?')

  const stale = (
    await q(`
    SELECT
      count(*) FILTER (WHERE newest_expiry < now())  AS all_expired,
      count(*) FILTER (WHERE newest_expiry >= now()) AS still_live,
      count(*)                                       AS total
    FROM (${CANDIDATES}) q
  `)
  )[0]!
  row('every row expired', stale.all_expired)
  row('has a live row', stale.still_live)
  console.log(
    '\n  ⚠ SportsPlayer carries expiresAt. A candidate whose only rows have\n' +
      '    expired is a cache artefact, not evidence the player exists — worth\n' +
      '    excluding, since the registry has no expiry of its own.',
  )

  /* ── Provenance ──────────────────────────────────────────────────────── */
  head('4. Where did these rows come from?')
  const sources = await q(`
    SELECT sp.source, count(DISTINCT ${n('sp.name')}) AS names
    FROM "SportsPlayer" sp
    WHERE sp.sport='NCAAF'
      AND NOT EXISTS (
        SELECT 1 FROM "PlayerIdentityMap" p
        WHERE p.sport='NCAAF' AND p."normalizedName" = ${n('sp.name')})
    GROUP BY sp.source ORDER BY 2 DESC`)
  sources.forEach((s) => console.log(`  ${String(s.source ?? 'null').padEnd(34)} ${num(s.names).toLocaleString().padStart(8)}`))

  /* ── What the inserted row would hold ────────────────────────────────── */
  head('5. How complete would an inserted row be?')
  const fields = (
    await q(`
    SELECT
      count(*) FILTER (WHERE with_position > 0) AS pos,
      count(*) FILTER (WHERE with_team > 0)     AS team,
      count(*) FILTER (WHERE with_college > 0)  AS college,
      count(*) FILTER (WHERE with_image > 0)    AS image,
      count(*) FILTER (WHERE with_dob > 0)      AS dob,
      count(*)                                  AS total
    FROM (${CANDIDATES}) q
  `)
  )[0]!
  row('would carry a position', fields.pos)
  row('would carry a team', fields.team)
  row('would carry a college', fields.college)
  row('would carry a headshot url', fields.image)
  row('would carry a dob', fields.dob)

  /* ── Collisions ──────────────────────────────────────────────────────── */
  head('6. Collisions')
  const dup = (
    await q(`SELECT count(*) AS c FROM (${CANDIDATES}) q WHERE row_count > 1`)
  )[0]!
  row('names backed by >1 SportsPlayer row', dup.c)
  console.log(
    '    (these COLLAPSE to one registry row — two real players sharing a\n' +
      '     name become one identity, which is the mis-link this registry exists\n' +
      '     to prevent. The writer needs a rule here, not a default.)',
  )

  const crossSport = (
    await q(`
    SELECT count(*) AS c FROM (${CANDIDATES}) q
    WHERE EXISTS (SELECT 1 FROM "PlayerIdentityMap" p
                  WHERE p."normalizedName" = q.norm AND p.sport <> 'NCAAF')`)
  )[0]!
  row('name already in PIM, other sport', crossSport.c)

  /*
   * 🛑 THE QUESTION THAT DECIDES THE WRITER'S SHAPE, AND THE ONLY ONE IN THIS
   * AUDIT WHOSE ANSWER COULD MAKE THE WHOLE WIDENING WRONG.
   *
   * A name backed by several rows is harmless if those rows are one person
   * cached repeatedly, and is a mis-link waiting to happen if they are several
   * people at several schools. Collapsing the second kind to one registry row
   * fuses real players — precisely the failure `PlayerIdentityMap` exists to
   * prevent, and one that surfaces later as another player's projection on
   * someone's roster rather than as an error.
   */
  head('6b. Are the collisions one person, or several?')
  const kinds = (
    await q(`
    SELECT
      count(*) FILTER (WHERE teams <= 1) AS one_school,
      count(*) FILTER (WHERE teams > 1)  AS many_schools,
      count(*)                            AS total
    FROM (
      SELECT ${n('sp.name')} AS norm, count(DISTINCT sp.team) AS teams
      FROM "SportsPlayer" sp
      WHERE sp.sport='NCAAF' AND ${n('sp.name')} <> ''
        AND NOT EXISTS (SELECT 1 FROM "PlayerIdentityMap" p
          WHERE p.sport='NCAAF' AND p."normalizedName" = ${n('sp.name')})
      GROUP BY ${n('sp.name')} HAVING count(*) > 1) z`)
  )[0]!
  const kt = num(kinds.total)
  console.log(`  ${'colliding names'.padEnd(34)} ${kt.toLocaleString().padStart(8)}`)
  console.log(
    `  ${'...all rows at ONE school (safe)'.padEnd(34)} ${num(kinds.one_school)
      .toLocaleString()
      .padStart(8)}   ${pct(num(kinds.one_school), kt)}`,
  )
  console.log(
    `  ${'...rows at SEVERAL schools (unsafe)'.padEnd(34)} ${num(kinds.many_schools)
      .toLocaleString()
      .padStart(8)}   ${pct(num(kinds.many_schools), kt)}`,
  )

  const worst = await q(`
    SELECT min(sp.name) AS nm, count(DISTINCT sp.team) AS teams, count(*) AS rows
    FROM "SportsPlayer" sp
    WHERE sp.sport='NCAAF' AND ${n('sp.name')} <> ''
      AND NOT EXISTS (SELECT 1 FROM "PlayerIdentityMap" p
        WHERE p.sport='NCAAF' AND p."normalizedName" = ${n('sp.name')})
    GROUP BY ${n('sp.name')} HAVING count(DISTINCT sp.team) > 1
    ORDER BY count(DISTINCT sp.team) DESC LIMIT 8`)
  console.log('\n  worst — distinct schools behind one name:')
  worst.forEach((r) =>
    console.log(`    ${String(r.nm).padEnd(26)} ${num(r.rows)} rows across ${num(r.teams)} schools`),
  )
  console.log(
    '\n  ⚠ Keying an insert on (name, team) rather than name alone is what\n' +
      '    separates these. It raises the row count and is the only version that\n' +
      '    does not fuse real players.',
  )

  /* ── Samples ─────────────────────────────────────────────────────────── */
  head('7. A sample of what would be inserted')
  const sample = await q(`
    SELECT sample_name, row_count, with_position, with_team, with_image
    FROM (${CANDIDATES}) q
    WHERE norm LIKE '% %' AND length(norm) >= 5 AND sample_name !~ '[0-9]'
    ORDER BY row_count DESC, sample_name
    LIMIT 15`)
  sample.forEach((s) =>
    console.log(
      `  ${String(s.sample_name).padEnd(30)} rows=${num(s.row_count)}  pos=${num(s.with_position) > 0 ? 'y' : 'n'}  team=${
        num(s.with_team) > 0 ? 'y' : 'n'
      }  img=${num(s.with_image) > 0 ? 'y' : 'n'}`,
    ),
  )

  head('8. And a sample of what a writer should REFUSE')
  const junkSample = await q(`
    SELECT sample_name, row_count FROM (${CANDIDATES}) q
    WHERE norm NOT LIKE '% %' OR length(norm) < 5
       OR lower(sample_name) ~ '(team|defense|special teams|d/st)'
       OR sample_name ~ '[0-9]'
    ORDER BY row_count DESC LIMIT 15`)
  if (junkSample.length === 0) console.log('  (none)')
  junkSample.forEach((s) => console.log(`  ${String(s.sample_name).padEnd(30)} rows=${num(s.row_count)}`))

  console.log('\nDRY RUN COMPLETE — nothing was written.\n')
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
