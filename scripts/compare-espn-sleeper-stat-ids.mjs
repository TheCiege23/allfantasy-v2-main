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
   stat id onto a derived column and look like a finding.
   ⚠ ONLY THE FANTASY-POINT TOTALS, NOT EVERY `pts_` KEY. This was `^pts_`, which also threw
   away `pts_allow` and every `pts_allow_<bucket>` — the team-defense stats ESPN's
   points-allowed rules are scored on — so those ids could never be found at all. */
const IGNORE_SLEEPER = /^(pts_(ppr|std|half_ppr)$|adp_|rank_|pos_rank_|tm_)/

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

/*
 * ⚠ A TEAM DEFENCE IS JOINED ON ITS CLUB NICKNAME, NOT ITS FULL NAME. ESPN calls it "Bills D/ST";
 * Sleeper calls it first "Buffalo", last "Bills". Joined on full name the two never met, so every
 * team-defense stat id sat outside the evidence entirely — absent for want of a join, not for
 * want of agreement. Nicknames are unique across the 32 clubs, and the `def:` prefix keeps a
 * defence from ever pairing with a player who shares the word.
 */
const ESPN_DST_POSITION_ID = 16
const espnDefKey = (fullName) => `def:${norm(String(fullName ?? '').replace(/\s*D\/ST\s*$/i, ''))}`
const sleeperDefKey = (lastName) => `def:${norm(lastName)}`

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
    const key = p.defaultPositionId === ESPN_DST_POSITION_ID ? espnDefKey(p.fullName) : norm(p.fullName)
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
    const isDef = String(p.position ?? row.position ?? '').toUpperCase() === 'DEF'
    const key = isDef ? sleeperDefKey(p.last_name) : norm(`${p.first_name ?? ''} ${p.last_name ?? ''}`)
    if (!key || !row.stats) continue
    if (out.has(key)) dupes.add(key)
    out.set(key, row.stats)
  }
  return { byName: out, dupes }
}

/* ─────────────────────────────────────────────────────────────────────────────────────────────
 * TEAM DEFENSE — A SECOND, STATED TIER. Read this before trusting anything it prints.
 *
 * The rule above (≥25 agreements, ZERO contradictions) is right for players and is kept exactly.
 * It cannot settle a team defense, for three measured reasons (2024+2025, 64 team-seasons):
 *
 *   1. Only 64 rows exist, and Sleeper OMITS a zero, so a rare event (a shutout, a safety) never
 *      reaches 25 comparisons even when it agrees every single time.
 *   2. Season totals carry STAT CORRECTIONS one provider applied and the other did not. Sacks
 *      agree on 62 of 64 team-seasons; the other two are 34 vs 35. One contradiction rejects it.
 *   3. Some ESPN ids are SUMS of Sleeper keys (fumble recoveries = `fum_rec` + `def_st_fum_rec`), and
 *      ESPN's points-allowed buckets have different edges from Sleeper's (14–17 vs 14–20), so no
 *      single key can ever match them.
 *
 * So this tier compares over EVERY joined team-season with an absent value read as 0 — which is
 * what makes a coincidence fail here: a key that merely shares a few small counts collects a
 * contradiction every time one side has the event and the other does not. It accepts a pairing
 * only when it is exact on ≥90% of team-seasons, every miss is within ±1, at least 3 team-seasons
 * are non-zero, and it is the ONLY key that passes. Sums are tested as declared hypotheses, never
 * searched for. Bucket edges are SEARCHED (every [lo, hi]) against Sleeper's per-game points
 * allowed, so the edges come out of the data rather than out of anyone's memory.
 * ───────────────────────────────────────────────────────────────────────────────────────────── */
const DEF_MIN_EXACT_SHARE = 0.9
const DEF_MIN_NONZERO = 3
const IGNORE_SLEEPER_DEF = /^(pts_(ppr|std|half_ppr)$|adp_|rank_|pos_rank_|tm_|fan_pts_|gp$)/

/** Sums worth testing. A hypothesis is a claim to check, not a mapping: it lands only if it passes. */
const DEF_SUM_HYPOTHESES = [
  { espn: ['96'], sleeper: ['fum_rec', 'def_st_fum_rec'] },
  { espn: ['93', '101', '102'], sleeper: ['def_st_td'] },
  { espn: ['103', '104'], sleeper: ['def_td'] },
  { espn: ['124', '125'], sleeper: ['pts_allow_35p'] },
]

/** ESPN ids whose meaning is a count of games in a points-allowed range. Edges are searched below. */
const DEF_POINTS_ALLOWED_IDS = ['89', '90', '91', '92', '121', '122', '123', '124', '125', '188', '189', '190', '194']

/**
 * The ladder `ScoringKeyAliasResolver` SHIPS (`pts_allow_range_<lo>_<hi>`; `null` hi = open-ended),
 * judged here as a whole so the evidence tests exactly what is scored. The search above picks each
 * edge; where the data cannot separate two (no game was decided by exactly 1 point allowed, nor by
 * more than 52), the buckets must partition 0..∞ with no gap or overlap, which settles it. Change one
 * side without the other and `__tests__/espn-team-defense-scoring.test.ts` fails.
 */
const DEF_POINTS_ALLOWED_LADDER = {
  '89': [0, 0], '90': [1, 6], '91': [7, 13], '92': [14, 17], '121': [18, 21], '122': [22, 27],
  '123': [28, 34], '124': [35, 45], '125': [46, null],
  '188': [0, 0], '189': [1, 6], '190': [7, 13], '194': [28, 34],
}
const RANGE_MAX = 70

const num = (v) => (typeof v === 'number' ? v : 0)

function judgeSeries(pairs) {
  let exact = 0
  let missByOne = 0
  let worse = 0
  let nonzero = 0
  for (const [a, b] of pairs) {
    if (a !== 0 || b !== 0) nonzero += 1
    if (a === b) exact += 1
    else if (Math.abs(a - b) === 1) missByOne += 1
    else worse += 1
  }
  const passes = worse === 0 && exact >= Math.ceil(DEF_MIN_EXACT_SHARE * pairs.length) && nonzero >= DEF_MIN_NONZERO
  return { exact, missByOne, worse, nonzero, of: pairs.length, passes }
}

async function fetchSleeperDefenseWeeks(season) {
  const byTeam = new Map()
  for (let week = 1; week <= 18; week++) {
    const res = await fetch(`${SLEEPER}/${season}/${week}?season_type=regular&position[]=DEF`)
    if (!res.ok) throw new Error(`Sleeper ${season} week ${week} returned ${res.status}`)
    for (const row of (await res.json()) ?? []) {
      const stats = row.stats ?? {}
      /*
       * ⚠ A SHUTOUT HAS NO `pts_allow` KEY AT ALL — Sleeper omits zeros. Skipping rows without it
       * dropped exactly the 10 shutouts in 2024–25 and failed ESPN's 0-points bucket against a
       * season flag that agrees 64/64. A row for a game that was played (`gp`, or any defensive
       * line) with no `pts_allow` is a 0; a row with no stats at all is not a game.
       */
      if (!(num(stats.gp) > 0 || typeof stats.yds_allow === 'number')) continue
      const pts = num(stats.pts_allow)
      const key = sleeperDefKey(row.player?.last_name)
      byTeam.set(key, [...(byTeam.get(key) ?? []), pts])
    }
  }
  return byTeam
}

async function teamDefenseEvidence(defenseSeasons) {
  const espnIds = [...new Set(defenseSeasons.flatMap((r) => Object.keys(r.espn)))].sort((a, b) => a - b)
  const sleeperKeys = [...new Set(defenseSeasons.flatMap((r) => Object.keys(r.sleeper)))].filter(
    (k) => !IGNORE_SLEEPER_DEF.test(k),
  )

  const singles = {}
  const ambiguous = {}
  for (const id of espnIds) {
    const passing = []
    for (const key of sleeperKeys) {
      const v = judgeSeries(defenseSeasons.map((r) => [num(r.espn[id]), num(r.sleeper[key])]))
      if (v.passes) passing.push({ sleeperKey: key, ...v })
    }
    if (passing.length === 1) singles[id] = passing[0]
    else if (passing.length > 1) ambiguous[id] = passing
  }

  const sums = DEF_SUM_HYPOTHESES.map((h) => ({
    ...h,
    ...judgeSeries(
      defenseSeasons.map((r) => [
        h.espn.reduce((t, id) => t + num(r.espn[id]), 0),
        h.sleeper.reduce((t, k) => t + num(r.sleeper[k]), 0),
      ]),
    ),
  }))

  const weeks = new Map()
  for (const season of [...new Set(defenseSeasons.map((r) => r.season))]) {
    weeks.set(season, await fetchSleeperDefenseWeeks(season))
  }
  const withWeeks = defenseSeasons.filter((r) => weeks.get(r.season)?.has(r.team))
  const ranges = {}
  for (const id of DEF_POINTS_ALLOWED_IDS) {
    if (!espnIds.includes(id)) continue
    const tried = []
    for (let lo = 0; lo <= RANGE_MAX; lo++) {
      for (const hi of [...Array.from({ length: RANGE_MAX - lo + 1 }, (_, i) => lo + i), null]) {
        const v = judgeSeries(
          withWeeks.map((r) => [
            num(r.espn[id]),
            weeks.get(r.season).get(r.team).filter((p) => p >= lo && (hi == null || p <= hi)).length,
          ]),
        )
        tried.push({ lo, hi, ...v })
      }
    }
    tried.sort((a, b) => b.exact - a.exact || a.worse - b.worse)
    ranges[id] = { best: tried.slice(0, 3), teamSeasons: withWeeks.length }
  }

  const ladder = {}
  for (const [id, [lo, hi]] of Object.entries(DEF_POINTS_ALLOWED_LADDER)) {
    if (!espnIds.includes(id)) continue
    const v = judgeSeries(
      withWeeks.map((r) => [
        num(r.espn[id]),
        weeks.get(r.season).get(r.team).filter((p) => p >= lo && (hi == null || p <= hi)).length,
      ]),
    )
    /* Shipped edges must score as well as the best range the search found, or they are not the edges. */
    ladder[id] = { lo, hi, ...v, matchesBestFound: v.exact >= (ranges[id]?.best[0]?.exact ?? Infinity) }
  }

  return { singles, ambiguous, sums, ranges, ladder, espnIdsObserved: espnIds, teamSeasons: defenseSeasons.length }
}

async function main() {
  const tally = new Map() // `${statId}|${sleeperKey}` -> {agree, disagree}
  const perSeason = {}
  let joined = 0
  let dropped = 0
  /* Counted apart so a join that silently fails reads as 0, not as "no defence id agreed". */
  let defJoined = 0
  /** Every joined team-defense season, kept for the team-defense phase below. */
  const defenseSeasons = []

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
      if (key.startsWith('def:')) {
        defJoined += 1
        defenseSeasons.push({ season, team: key, espn: espnStats, sleeper: sleeperStats })
      }
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
    teamDefenseSeasonsJoined: defJoined,
    namesDroppedAsNonUnique: dropped,
    mappings: Object.fromEntries(
      Object.entries(accepted)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([id, m]) => [id, { sleeperKey: m.sleeperKey, agreeingPlayerSeasons: m.agree }]),
    ),
    ambiguousNotAccepted: ambiguous,
    teamDefense: {
      method:
        'stated tier for ESPN D/ST rows only: absent read as 0 over every joined team-season; a pairing passes when exact on >= 90% of team-seasons, every miss is within +/-1, >= 3 team-seasons are non-zero, and it is the only key that passes. Sums are declared hypotheses, tested. Points-allowed bucket edges are searched over every [lo, hi] against Sleeper weekly pts_allow.',
      thresholds: { minExactShare: DEF_MIN_EXACT_SHARE, maxMiss: 1, minNonZeroTeamSeasons: DEF_MIN_NONZERO },
      ...(await teamDefenseEvidence(defenseSeasons)),
    },
  }

  const out = process.argv[2] ?? 'lib/scoring-defaults/espn-stat-id-evidence.json'
  writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`)

  console.log(`player-seasons joined: ${joined} ${JSON.stringify(perSeason)}`)
  console.log(`names dropped as non-unique: ${dropped}`)
  console.log(`team-defense seasons joined: ${defJoined}`)
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
  const td = evidence.teamDefense
  console.log(`\nTEAM DEFENSE (stated tier, ${td.teamSeasons} team-seasons):`)
  for (const [id, m] of Object.entries(td.singles)) {
    console.log(`  ${id} -> ${m.sleeperKey}  exact ${m.exact}/${m.of}${m.missByOne ? ` (±1 on ${m.missByOne})` : ''}, non-zero ${m.nonzero}`)
  }
  for (const [id, list] of Object.entries(td.ambiguous)) {
    console.log(`  ${id} REFUSED, ambiguous: ${list.map((x) => x.sleeperKey).join(', ')}`)
  }
  console.log(`  sums:`)
  for (const s of td.sums) {
    console.log(`    ${s.espn.join('+')} = ${s.sleeper.join('+')}  ${s.passes ? 'PASS' : 'fail'}  exact ${s.exact}/${s.of}, ±1 ${s.missByOne}, worse ${s.worse}`)
  }
  console.log(`  points-allowed ranges (top 3 per id):`)
  for (const [id, r] of Object.entries(td.ranges)) {
    console.log(`    ${id}: ${r.best.map((b) => `[${b.lo},${b.hi ?? '∞'}] ${b.exact}/${b.of}${b.passes ? '' : ' ✗'}`).join('   ')}`)
  }
  console.log(`  shipped points-allowed ladder:`)
  for (const [id, l] of Object.entries(td.ladder)) {
    console.log(`    ${id}: [${l.lo},${l.hi ?? '∞'}] exact ${l.exact}/${l.of}${l.passes ? '' : ' ✗ FAILS THE TIER'}${l.matchesBestFound ? '' : ' ✗ WORSE THAN THE SEARCH'}`)
  }
  console.log(`\nevidence written to ${out}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
