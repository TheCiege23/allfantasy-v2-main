#!/usr/bin/env node
/**
 * Compare what ESPN publishes against what Sleeper publishes, to learn which numeric
 * ESPN fantasy stat id names the same quantity as which Sleeper stat key.
 *
 * ⚠ WHY THIS SCRIPT EXISTS AT ALL. `ScoringKeyAliasResolver` needs
 * `espn_stat_<id>` -> Sleeper key to score an imported ESPN league, and ESPN ships no
 * dictionary: its `scoringItems` carry `{statId, points}` and nothing that names the
 * stat. For a long time the resolver therefore held exactly ONE mapping (53 =
 * receptions, the id the PPR-detection code independently keys on) and refused to
 * guess the rest — correctly, because a guessed scoring key silently mis-scores every
 * player in a league.
 *
 * This replaces guessing with evidence. Both providers publish the same season for the
 * same players. Where an ESPN stat id and a Sleeper key hold the SAME value for the
 * same player, across hundreds of players and more than one season, with not a single
 * player where they disagree, that is evidence they name the same quantity.
 *
 * Hand-run, absent from package.json and CI. Writes only a JSON evidence file; commit
 * it in the same change as any resolver update, so the mapping and its proof travel
 * together and the next person can re-derive rather than re-trust.
 *
 *   node scripts/compare-espn-sleeper-stat-ids.mjs [outputPath]
 */
import { writeFileSync } from 'node:fs'

/*
 * These two literals are permitted by the guard's `scripts/.*compare` path rule, not by
 * a `db-first-exception:` marker. The marker is reserved for a TEMPORARY violation with
 * a migration plan, and using it for a permanent, legitimate one blunts it for everyone
 * — the same reasoning that kept it off the weather geocode cache.
 */
const ESPN = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons'
const SLEEPER = 'https://api.sleeper.com/stats/nfl'

const SEASONS = [2025, 2024]
const MIN_AGREE = 25
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']

/* Sleeper's own aggregates and rankings, not stats. Including them would map an ESPN
   stat id onto a derived column and look like a finding. */
const IGNORE_SLEEPER = /^(pts_|adp_|rank_|pos_rank_|tm_)/

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

async function fetchEspnSeason(season) {
  const res = await fetch(
    `${ESPN}/${season}/players?scoringPeriodId=0&view=kona_player_info`,
    {
      headers: { accept: 'application/json', 'x-fantasy-filter': '{"players":{"limit":5}}' },
    },
  )
  if (!res.ok) throw new Error(`ESPN ${season} returned ${res.status}`)
  const body = await res.json()
  const rows = Array.isArray(body) ? body : (body.players ?? [])
  const out = new Map()
  const dupes = new Set()
  for (const row of rows) {
    const p = row.player ?? row
    /* statSourceId 0 = actual (1 is projection); statSplitTypeId 0 = season total. */
    const total = (p.stats ?? []).find(
      (s) => s.seasonId === season && s.statSourceId === 0 && s.statSplitTypeId === 0,
    )
    if (!total?.stats || Object.keys(total.stats).length === 0) continue
    const key = norm(p.fullName)
    if (!key) continue
    if (out.has(key)) dupes.add(key)
    out.set(key, total.stats)
  }
  return { byName: out, dupes }
}

async function fetchSleeperSeason(season) {
  const query = POSITIONS.map((p) => `position[]=${p}`).join('&')
  const res = await fetch(`${SLEEPER}/${season}?season_type=regular&${query}&order_by=pts_ppr`)
  if (!res.ok) throw new Error(`Sleeper ${season} returned ${res.status}`)
  const rows = await res.json()
  const out = new Map()
  const dupes = new Set()
  for (const row of rows ?? []) {
    const p = row.player ?? {}
    const key = norm(`${p.first_name ?? ''} ${p.last_name ?? ''}`)
    if (!key || !row.stats) continue
    if (out.has(key)) dupes.add(key)
    out.set(key, row.stats)
  }
  return { byName: out, dupes }
}

async function main() {
  const tally = new Map() // `${statId}|${sleeperKey}` -> {agree, disagree}
  const perSeason = {}
  let joined = 0
  let dropped = 0

  for (const season of SEASONS) {
    const [espn, sleeper] = await Promise.all([fetchEspnSeason(season), fetchSleeperSeason(season)])
    let n = 0
    for (const [key, espnStats] of espn.byName) {
      /*
       * A name that is not unique on BOTH sides is dropped entirely. There are two
       * Maurice Alexanders and two Tony Adamses in the NFL; joining those on name
       * would pair one man's stat line with another's, and a contradiction
       * manufactured that way would disqualify a mapping that is actually true.
       */
      if (espn.dupes.has(key) || sleeper.dupes.has(key)) {
        dropped += 1
        continue
      }
      const sleeperStats = sleeper.byName.get(key)
      if (!sleeperStats) continue
      n += 1
      for (const [statId, ev] of Object.entries(espnStats)) {
        if (typeof ev !== 'number') continue
        for (const [sKey, sv] of Object.entries(sleeperStats)) {
          if (typeof sv !== 'number' || IGNORE_SLEEPER.test(sKey)) continue
          const k = `${statId}|${sKey}`
          const t = tally.get(k) ?? { agree: 0, disagree: 0 }
          /* Exact equality only. A scaled match (67.33 against 0.6733) is a different
             quantity as far as a scoring weight is concerned, and admitting it would
             invite unit errors that are invisible in the output. */
          if (ev === sv) t.agree += 1
          else t.disagree += 1
          tally.set(k, t)
        }
      }
    }
    perSeason[season] = n
    joined += n
  }

  /* Pooled across seasons on purpose: an id that meant one thing in 2024 and another
     in 2025 produces contradictions here and is rejected automatically, which a
     single-season derivation could never notice. */
  const candidates = new Map()
  for (const [k, t] of tally) {
    if (t.agree < MIN_AGREE || t.disagree > 0) continue
    const [statId, sKey] = k.split('|')
    const list = candidates.get(statId) ?? []
    list.push({ sleeperKey: sKey, agree: t.agree })
    candidates.set(statId, list)
  }

  const accepted = {}
  const ambiguous = {}
  for (const [statId, list] of candidates) {
    list.sort((a, b) => b.agree - a.agree)
    if (list.length === 1) {
      accepted[statId] = list[0]
      continue
    }
    /*
     * Sleeper carries position-scoped duplicates — `bonus_rec_wr` is receptions, but
     * only present for wide receivers. Those tie with the universal key wherever they
     * appear, which is not a real ambiguity: the universal key is a superset and the
     * others are the same quantity filtered by position. Resolve to the superset when
     * it strictly dominates; otherwise refuse and report.
     */
    const [top, ...rest] = list
    if (rest.every((r) => r.agree < top.agree)) accepted[statId] = { ...top, subsumed: rest }
    else ambiguous[statId] = list
  }

  const evidence = {
    derivedAt: new Date().toISOString(),
    seasons: SEASONS,
    method:
      'exact-value agreement between ESPN fantasy season totals (statSourceId 0, statSplitTypeId 0) and Sleeper season stats, joined only on names unique to both sources, pooled across seasons',
    thresholds: { minAgreeingPlayerSeasons: MIN_AGREE, maxContradictions: 0 },
    playerSeasonsJoined: joined,
    playerSeasonsByYear: perSeason,
    namesDroppedAsNonUnique: dropped,
    mappings: Object.fromEntries(
      Object.entries(accepted)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([id, m]) => [id, { sleeperKey: m.sleeperKey, agreeingPlayerSeasons: m.agree }]),
    ),
    ambiguousNotAccepted: ambiguous,
  }

  const out = process.argv[2] ?? 'lib/scoring-defaults/espn-stat-id-evidence.json'
  writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`)

  console.log(`player-seasons joined: ${joined} ${JSON.stringify(perSeason)}`)
  console.log(`names dropped as non-unique: ${dropped}`)
  console.log(`\nACCEPTED (>=${MIN_AGREE} agreeing player-seasons, ZERO contradictions):`)
  for (const [id, m] of Object.entries(evidence.mappings)) {
    console.log(`  '${id}': '${m.sleeperKey}',`.padEnd(34) + ` // ${m.agreeingPlayerSeasons}`)
  }
  if (Object.keys(ambiguous).length > 0) {
    console.log(`\nREFUSED as ambiguous:`)
    for (const [id, list] of Object.entries(ambiguous)) {
      console.log(`  ${id} -> ${list.map((x) => `${x.sleeperKey}(${x.agree})`).join(', ')}`)
    }
  }
  console.log(`\nevidence written to ${out}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
