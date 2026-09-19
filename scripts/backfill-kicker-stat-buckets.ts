/**
 * Rewrite `player_game_stats.normalized_stat_map` (and `fantasyPoints`) for kicker rows stamped
 * before the field-goal distance buckets existed. See `lib/schedule-stats/StatNormalizationService.ts`.
 *
 * ⚠ WHY THIS SCRIPT EXISTS — FIXING THE NORMALIZER DOES NOT REACH STORED ROWS. The map is computed
 * once, at ingest. The scoring template prices `fg_0_39` (3), `fg_40_49` (4) and `fg_50_plus` (5);
 * the feed sends `fgm` (the total made), `fgm_40_49`, `fgm_50p` and `fgm_50_59`. Until these rows
 * are rewritten, every kick under forty yards and every kick of fifty or more scores nothing.
 *
 * Measured on the test database, 2026-09-19, before any write:
 *   NFL rows                       252,768
 *   carrying `fgm`                   3,098
 *   carrying `fg_0_39`                   0     ← the bucket the template charges most often for
 *   carrying `fg_50_plus`                0     ← `fgm_50p` sat unmapped in 843 of them
 *   carrying `fg_40_49`              1,357     ← the one bucket that always worked
 *   NCAAF rows                           0
 *
 * ⚠ SCOPE IS DELIBERATELY NARROW, AND THE SHAPE TEST IS THE SCOPE. A row is rewritten only when
 *   1. its raw `stat_payload` carries `fgm`,
 *   2. re-normalizing that payload differs from the stored map ONLY in the kicking keys this fix
 *      introduced, every other key being byte-identical, and
 *   3. the difference is non-empty.
 * Condition 2 is what makes this safe without reimplementing the old normalizer: a row touched by
 * anything else disagrees somewhere outside those keys and is counted as `other writer`, not
 * rewritten. In particular a row still awaiting `backfill-interception-split` is left to that
 * script rather than half-fixed by this one.
 *
 * `fantasyPoints` is rewritten only when the stored value also reconciles with the STORED map
 * under the template the import uses (`getScoringTemplate(sport, 'standard')`); a row written
 * under other rules keeps its points, and is counted.
 *
 * Usage (report only unless --apply):
 *   npx tsx scripts/backfill-kicker-stat-buckets.ts --staging --env-root F:/allfantasy-v2-main
 *   npx tsx scripts/backfill-kicker-stat-buckets.ts --staging --env-root <dir> --apply
 *   npx tsx scripts/backfill-kicker-stat-buckets.ts --apply --production     # PRODUCTION — the user's call
 *
 * ⚠ Without --staging this reads `.env` / `.env.local`, which in this repo is PRODUCTION. Report
 * mode writes nothing anywhere; --apply against production additionally requires --production.
 * `--env-root` names the checkout holding the env files (a worktree has none of its own).
 */

import fs from 'node:fs'
import path from 'node:path'
import { normalizeStatPayload } from '../lib/schedule-stats/StatNormalizationService'
import { computeFantasyPoints, type ScoringRuleLike } from '../lib/scoring-defaults/FantasyPointCalculator'
import { getDefaultScoringTemplate } from '../lib/scoring-defaults/ScoringDefaultsRegistry'

/* eslint-disable @typescript-eslint/no-var-requires */
const { resolveTarget } = require('./_prod-sql-target.cjs')

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(name)
const option = (name: string) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}

const APPLY = flag('--apply')
const STAGING = flag('--staging')
const PRODUCTION_OK = flag('--production')
const ENV_ROOT = option('--env-root') ?? __dirname
const SPORTS = ['NFL', 'NCAAF']
const PAGE = 1000
const WRITE_CHUNK = 200

/**
 * The only keys this fix is allowed to move.
 *
 * `fg_0_39` and `fg_50_plus` are what it adds. `fgm_50p` and `fgm_50_59` are the feed spellings
 * that now alias into `fg_50_plus`, so they legitimately DISAPPEAR from the map — which is a
 * difference, and has to be a permitted one.
 */
const KICKING_KEYS = new Set(['fg_0_39', 'fg_50_plus', 'fgm_50p', 'fgm_50_59'])

type Stats = Record<string, number>
type Row = {
  id: string
  sportType: string
  playerId: string
  season: number
  weekOrRound: number
  stat_payload: Record<string, unknown>
  normalized_stat_map: Record<string, unknown>
  fantasyPoints: number
}
type Planned = {
  row: Row
  next: Stats
  nextPoints: number
  pointsRewritten: boolean
  addedShort: number
  addedLong: number
}

function numericOnly(obj: Record<string, unknown> | null | undefined): Stats {
  const out: Stats = {}
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (typeof v === 'number' && !Number.isNaN(v)) out[k] = v
  }
  return out
}

/**
 * Which keys two maps disagree on — present in one and not the other, or holding different values.
 */
function differingKeys(a: Stats, b: Stats): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const out: string[] = []
  for (const k of keys) {
    const av = a[k]
    const bv = b[k]
    if (av === undefined || bv === undefined) out.push(k)
    else if (Math.abs(av - bv) >= 1e-9) out.push(k)
  }
  return out
}

const round2 = (n: number) => Math.round(n * 100) / 100

async function rulesFor(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  sport: string,
): Promise<{ rules: ScoringRuleLike[]; source: string }> {
  // Mirrors `getScoringTemplate(sport, 'standard')`: a stored template wins, the registry is the fallback.
  const { rows } = await client.query(
    `SELECT r."statKey", r."pointsValue", r.multiplier, r.enabled
       FROM scoring_templates t JOIN scoring_rules r ON r."templateId" = t.id
      WHERE t."sportType" = $1 AND t."formatType" = 'standard'`,
    [sport],
  )
  if (rows.length > 0) return { rules: rows as ScoringRuleLike[], source: `stored template (${rows.length} rules)` }
  return { rules: getDefaultScoringTemplate(sport, 'standard').rules, source: 'registry default' }
}

async function main() {
  const target = resolveTarget(ENV_ROOT, STAGING ? { envFiles: ['.env.test'] } : {})
  console.log(`target : ${target.description}${target.isProduction ? '  ⚠ PRODUCTION' : ''}`)
  console.log(`mode   : ${APPLY ? 'APPLY (writes)' : 'report only (no writes)'}`)
  if (APPLY && target.isProduction && !PRODUCTION_OK) {
    console.log('\n🛑 REFUSING: --apply against production needs --production as well. That is the user’s decision.')
    process.exitCode = 1
    return
  }

  const client = target.newClient()
  await client.connect()
  try {
    const { rows: shape } = await client.query(
      `SELECT count(*)::int                                                  AS n,
              count(*) FILTER (WHERE stat_payload ? 'fgm')::int              AS with_fgm,
              count(*) FILTER (WHERE normalized_stat_map ? 'fg_0_39')::int   AS with_short,
              count(*) FILTER (WHERE normalized_stat_map ? 'fg_50_plus')::int AS with_long
         FROM player_game_stats WHERE "sportType" = ANY($1)`,
      [SPORTS],
    )
    console.log(`\nrows in scope sports          : ${shape[0].n}`)
    console.log(`raw payloads carrying \`fgm\`   : ${shape[0].with_fgm}`)
    console.log(`stored maps with \`fg_0_39\`    : ${shape[0].with_short}`)
    console.log(`stored maps with \`fg_50_plus\` : ${shape[0].with_long}`)

    const planned: Planned[] = []
    const counts = { scanned: 0, unchanged: 0, otherWriter: 0, pointsUnreconciled: 0 }
    const otherWriterKeys = new Map<string, number>()
    let pointDelta = 0

    for (const sport of SPORTS) {
      const { rows: probe } = await client.query(
        `SELECT 1 FROM player_game_stats WHERE "sportType" = $1 AND stat_payload ? 'fgm' LIMIT 1`,
        [sport],
      )
      if (probe.length === 0) {
        console.log(`${sport} rules : (no rows carrying \`fgm\` — skipped)`)
        continue
      }
      const { rules, source } = await rulesFor(client, sport)
      console.log(`${sport} rules : ${source}`)

      let after = ''
      for (;;) {
        const { rows } = (await client.query(
          `SELECT id, "sportType", "playerId", season, "weekOrRound", stat_payload, normalized_stat_map, "fantasyPoints"
             FROM player_game_stats
            WHERE "sportType" = $1 AND stat_payload ? 'fgm' AND id > $2
            ORDER BY id LIMIT $3`,
          [sport, after, PAGE],
        )) as { rows: Row[] }
        if (rows.length === 0) break
        after = rows[rows.length - 1].id

        for (const row of rows) {
          counts.scanned++
          const payload = numericOnly(row.stat_payload)
          const stored = numericOnly(row.normalized_stat_map)
          const next = normalizeStatPayload(sport, payload)

          const diff = differingKeys(stored, next)
          if (diff.length === 0) {
            counts.unchanged++
            continue
          }
          const foreign = diff.filter((k) => !KICKING_KEYS.has(k))
          if (foreign.length > 0) {
            // Disagrees somewhere this fix has no business touching — leave the row alone.
            counts.otherWriter++
            for (const k of foreign) otherWriterKeys.set(k, (otherWriterKeys.get(k) ?? 0) + 1)
            continue
          }

          /*
           * `fantasyPoints` is reconciled against the STORED map, not a reconstructed legacy one:
           * the question is whether the number on the row is what these rules make of the map that
           * is on the row. If it is, the same rules over the corrected map are the right answer.
           */
          const reconciles = Math.abs(round2(computeFantasyPoints(stored, rules)) - row.fantasyPoints) < 0.005
          const nextPoints = reconciles ? computeFantasyPoints(next, rules) : row.fantasyPoints
          if (!reconciles) counts.pointsUnreconciled++
          else pointDelta += nextPoints - row.fantasyPoints

          planned.push({
            row,
            next,
            nextPoints,
            pointsRewritten: reconciles,
            addedShort: (next.fg_0_39 ?? 0) - (stored.fg_0_39 ?? 0),
            addedLong: (next.fg_50_plus ?? 0) - (stored.fg_50_plus ?? 0),
          })
        }
      }
    }

    const sum = (pick: (p: Planned) => number) => planned.reduce((n, p) => n + pick(p), 0)
    console.log(`\nrows scanned                  : ${counts.scanned}`)
    console.log(`already correct               : ${counts.unchanged}`)
    console.log(`skipped (other writer)        : ${counts.otherWriter}`)
    if (otherWriterKeys.size > 0) {
      const top = [...otherWriterKeys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      console.log(`  disagreeing keys            : ${top.map(([k, n]) => `${k}×${n}`).join(', ')}`)
    }
    console.log(`rows this fix would rewrite   : ${planned.length}`)
    console.log(`  field goals under 40 recovered : ${round2(sum((p) => p.addedShort))}`)
    console.log(`  field goals of 50+ recovered   : ${round2(sum((p) => p.addedLong))}`)
    console.log(`  fantasyPoints rewritten     : ${planned.filter((p) => p.pointsRewritten).length}`)
    console.log(`  fantasyPoints left (other rules): ${counts.pointsUnreconciled}`)
    console.log(`  total fantasyPoints change  : ${round2(pointDelta)}`)

    const sample = planned.find((p) => p.pointsRewritten && p.addedLong > 0) ?? planned.find((p) => p.pointsRewritten)
    if (sample) {
      const stored = numericOnly(sample.row.normalized_stat_map)
      console.log(`\nsample: ${sample.row.sportType} ${sample.row.playerId} ${sample.row.season} wk${sample.row.weekOrRound}`)
      console.log(
        `  map    : fgm=${stored.fgm ?? '-'} fg_0_39=${stored.fg_0_39 ?? '-'} fg_40_49=${stored.fg_40_49 ?? '-'} fg_50_plus=${stored.fg_50_plus ?? '-'}` +
          `  ->  fg_0_39=${sample.next.fg_0_39 ?? '-'} fg_40_49=${sample.next.fg_40_49 ?? '-'} fg_50_plus=${sample.next.fg_50_plus ?? '-'}`,
      )
      console.log(`  points : ${sample.row.fantasyPoints} -> ${round2(sample.nextPoints)}`)
    }

    if (planned.length === 0) {
      console.log('\nNothing to do.')
      return
    }
    if (!APPLY) {
      console.log('\nReport only — re-run with --apply to write.')
      return
    }

    const snapshot = path.join(
      __dirname,
      `.kicker-stat-buckets-snapshot-${target.description.replace(/[^a-z0-9-]+/gi, '_')}-${planned.length}.json`,
    )
    fs.writeFileSync(
      snapshot,
      JSON.stringify(
        planned.map((p) => ({ id: p.row.id, normalized_stat_map: p.row.normalized_stat_map, fantasyPoints: p.row.fantasyPoints })),
        null,
        1,
      ),
    )
    console.log(`\nsnapshot: ${snapshot}`)

    let updated = 0
    for (let i = 0; i < planned.length; i += WRITE_CHUNK) {
      const chunk = planned.slice(i, i + WRITE_CHUNK)
      await client.query('BEGIN')
      for (const p of chunk) {
        // Guard on the OLD values, so a row re-ingested since the scan is never clobbered.
        const res = await client.query(
          `UPDATE player_game_stats
              SET normalized_stat_map = $1::jsonb, "fantasyPoints" = $2, "updatedAt" = now()
            WHERE id = $3 AND normalized_stat_map = $4::jsonb AND "fantasyPoints" = $5`,
          [JSON.stringify(p.next), round2(p.nextPoints), p.row.id, JSON.stringify(p.row.normalized_stat_map), p.row.fantasyPoints],
        )
        updated += res.rowCount ?? 0
      }
      await client.query('COMMIT')
    }
    console.log(`updated: ${updated} row(s)`)
    if (updated !== planned.length) console.log(`⚠ ${planned.length - updated} row(s) changed underneath this run and were skipped.`)
  } catch (err) {
    try {
      await client.query('ROLLBACK')
    } catch {
      /* already unwound */
    }
    throw err
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((err) => {
  console.error('[backfill-kicker-stat-buckets] failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
