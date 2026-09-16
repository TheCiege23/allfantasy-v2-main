/**
 * Rewrite `player_game_stats.normalized_stat_map` (and `fantasyPoints`) for the rows the OLD
 * normalizer merged: a quarterback's thrown `pass_int` and a team defense's `int` both landed in
 * `interception`. See `lib/schedule-stats/StatNormalizationService.ts`.
 *
 * ⚠ WHY THIS SCRIPT EXISTS — FIXING THE NORMALIZER DOES NOT REACH STORED ROWS. The map is computed
 * once, at ingest. Until these rows are rewritten:
 *   - league scoring still ignores both picks (it never reads `interception`, on purpose);
 *   - every team defense's stored `fantasyPoints` still carries −2 per interception instead of +2.
 *
 * ⚠ SCOPE IS DELIBERATELY NARROW. A row is rewritten only when
 *   1. its raw `stat_payload` carries `pass_int` or `int`,
 *   2. its stored map is EXACTLY what the old normalizer produced from that payload, and
 *   3. the new normalizer produces something different.
 * `fantasyPoints` is rewritten only when the stored value also reconciles with the old map under
 * the template the import uses (`getScoringTemplate(sport, 'standard')`); a row written under other
 * rules keeps its points, and is counted.
 *
 * Usage (report only unless --apply):
 *   npx tsx scripts/backfill-interception-split.ts --staging --env-root F:/allfantasy-v2-main
 *   npx tsx scripts/backfill-interception-split.ts --staging --env-root <dir> --apply
 *   npx tsx scripts/backfill-interception-split.ts --apply --production     # PRODUCTION — the user's call
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
  kind: 'passer' | 'team_defense' | 'both'
  next: Stats
  nextPoints: number
  pointsRewritten: boolean
}

function numericOnly(obj: Record<string, unknown> | null | undefined): Stats {
  const out: Stats = {}
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (typeof v === 'number' && !Number.isNaN(v)) out[k] = v
  }
  return out
}

/**
 * The OLD normalizer, reproduced so rows it stamped can be recognised. Every key maps exactly as it
 * does today EXCEPT the two this fix separates, which both went to `interception`. Do not "tidy"
 * this into a call to the new function — its whole job is to reproduce the bug.
 */
function legacyNormalize(sport: string, payload: Stats): Stats {
  const out: Stats = {}
  for (const [key, value] of Object.entries(payload)) {
    const canonical =
      key === 'pass_int' || key === 'int'
        ? 'interception'
        : Object.keys(normalizeStatPayload(sport, { [key]: value }))[0] ?? key
    out[canonical] = (out[canonical] ?? 0) + value
  }
  return out
}

function sameMap(a: Stats, b: Stats): boolean {
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false
  return ka.every((k) => Math.abs(a[k] - b[k]) < 1e-9)
}

const round2 = (n: number) => Math.round(n * 100) / 100

async function rulesFor(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }, sport: string): Promise<{ rules: ScoringRuleLike[]; source: string }> {
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
    const { rows: rawInterception } = await client.query(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE stat_payload ? 'interception')::int AS with_key
         FROM player_game_stats WHERE "sportType" = ANY($1)`,
      [SPORTS],
    )
    console.log(`\nrows in scope sports          : ${rawInterception[0].n}`)
    console.log(`raw payloads carrying \`interception\`: ${rawInterception[0].with_key}  (the normalizer's skip assumes 0)`)

    const planned: Planned[] = []
    const counts = { scanned: 0, unchanged: 0, otherWriter: 0, pointsUnreconciled: 0 }
    const pointDelta = { passer: 0, team_defense: 0, both: 0 }

    for (const sport of SPORTS) {
      const { rules, source } = await rulesFor(client, sport)
      console.log(`${sport} rules : ${source}`)
      let after = ''
      for (;;) {
        const { rows } = (await client.query(
          `SELECT id, "sportType", "playerId", season, "weekOrRound", stat_payload, normalized_stat_map, "fantasyPoints"
             FROM player_game_stats
            WHERE "sportType" = $1 AND (stat_payload ? 'pass_int' OR stat_payload ? 'int') AND id > $2
            ORDER BY id LIMIT $3`,
          [sport, after, PAGE],
        )) as { rows: Row[] }
        if (rows.length === 0) break
        after = rows[rows.length - 1].id

        for (const row of rows) {
          counts.scanned++
          const payload = numericOnly(row.stat_payload)
          const stored = numericOnly(row.normalized_stat_map)
          const legacy = legacyNormalize(sport, payload)
          const next = normalizeStatPayload(sport, payload)
          if (sameMap(stored, next)) {
            counts.unchanged++
            continue
          }
          if (!sameMap(stored, legacy)) {
            // Written by something other than the old normalizer — not this fix's to touch.
            counts.otherWriter++
            continue
          }
          const kind: Planned['kind'] =
            payload.pass_int != null && payload.int != null ? 'both' : payload.pass_int != null ? 'passer' : 'team_defense'
          const reconciles = Math.abs(round2(computeFantasyPoints(legacy, rules)) - row.fantasyPoints) < 0.005
          const nextPoints = reconciles ? computeFantasyPoints(next, rules) : row.fantasyPoints
          if (!reconciles) counts.pointsUnreconciled++
          else pointDelta[kind] += nextPoints - row.fantasyPoints
          planned.push({ row, kind, next, nextPoints, pointsRewritten: reconciles })
        }
      }
    }

    const byKind = (k: Planned['kind']) => planned.filter((p) => p.kind === k).length
    console.log(`\nrows scanned                  : ${counts.scanned}`)
    console.log(`already correct               : ${counts.unchanged}`)
    console.log(`skipped (other writer)        : ${counts.otherWriter}`)
    console.log(`rows this fix would rewrite   : ${planned.length}  (passer ${byKind('passer')}, team defense ${byKind('team_defense')}, both ${byKind('both')})`)
    console.log(`  fantasyPoints rewritten     : ${planned.filter((p) => p.pointsRewritten).length}`)
    console.log(`  fantasyPoints left (other rules): ${counts.pointsUnreconciled}`)
    console.log(`  total fantasyPoints change  : passer ${round2(pointDelta.passer)}, team defense ${round2(pointDelta.team_defense)}, both ${round2(pointDelta.both)}`)

    const sample = (k: Planned['kind']) => planned.find((p) => p.kind === k && p.pointsRewritten)
    for (const k of ['passer', 'team_defense'] as const) {
      const s = sample(k)
      if (!s) continue
      console.log(`\nsample ${k}: ${s.row.sportType} ${s.row.playerId} ${s.row.season} wk${s.row.weekOrRound}`)
      console.log(`  map    : interception=${s.row.normalized_stat_map.interception}  ->  ` +
        `interception=${s.next.interception ?? '-'} pass_int=${s.next.pass_int ?? '-'} dst_interception=${s.next.dst_interception ?? '-'}`)
      console.log(`  points : ${s.row.fantasyPoints} -> ${round2(s.nextPoints)}`)
    }

    if (planned.length === 0) {
      console.log('\nNothing to do.')
      return
    }
    if (!APPLY) {
      console.log('\nReport only — re-run with --apply to write.')
      return
    }

    const snapshot = path.join(__dirname, `.interception-split-snapshot-${target.description.replace(/[^a-z0-9-]+/gi, '_')}-${planned.length}.json`)
    fs.writeFileSync(
      snapshot,
      JSON.stringify(planned.map((p) => ({ id: p.row.id, normalized_stat_map: p.row.normalized_stat_map, fantasyPoints: p.row.fantasyPoints })), null, 1),
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
  console.error('[backfill-interception-split] failed:', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
