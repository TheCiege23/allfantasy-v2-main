/**
 * Player game stats from nflverse — the Sleeper-independent replacement.
 *
 *   npx tsx scripts/ingest-nflverse-stats.ts [fromSeason] [toSeason]
 *
 * ⚠ THIS IS A REPLACEMENT, NOT A FALLBACK. It is strictly better than the Sleeper
 * ingest on three counts and should be adopted regardless of how the licensing
 * conversation lands:
 *
 *   COVERAGE   ~19,000 rows/season vs ~2,200 — because nflverse is not limited to
 *              fantasy skill positions. Linemen, punters and EVERY DEFENDER are in
 *              it. That surplus is full IDP coverage.
 *   DEPTH      1999+, all 7 IDP scoring categories, plus target_share,
 *              air_yards_share, wopr, racr, pacr and EPA — most of a projection
 *              feature set, free.
 *   LICENCE    CC-BY-4.0, commercial use permitted, irrevocable. Obligation is
 *              attribution, which the app must render.
 *
 * ⚠ NEVER USE nflverse `fantasy_points` / `fantasy_points_ppr`. Measured on the
 * 2024 file: 569 of 569 KICKERS score exactly 0.00. The formula is offense-only,
 * standard and full-PPR only, no half-PPR and no IDP. A pipeline trusting it
 * silently zeroes every kicker while looking perfectly healthy. Score from raw
 * stat columns — which lib/projections/leagueScoring.ts already does.
 *
 * ⚠ RE-PULL WEDNESDAY NIGHT. Stat corrections land Monday-Wednesday; the
 * maintainers' own guidance is that Thursday's data is the cleanest. There is no
 * fast post-game path for stats.
 */
import zlib from 'node:zlib'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const STATS = (s: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${s}.csv`
const PLAYERS = 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv'

const FROM = Number(process.argv[2] ?? 2024)
const TO = Number(process.argv[3] ?? 2024)

/**
 * Minimum share of stat rows that must resolve to one of our players.
 *
 * ⚠ FAIL LOUD RATHER THAN INGEST A HOLE. A silent join failure shows up later as a
 * player mysteriously worth zero, which users notice before we do.
 */
const MIN_JOIN_COVERAGE = 0.9

function splitCsv(line: string): string[] {
  const out: string[] = []
  let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"') inQ = !inQ
    else if (ch === ',' && !inQ) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

const num = (v: string | undefined): number | null => {
  if (v == null) return null
  const t = v.trim()
  if (!t || t === 'NA') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Match key: name + position. Deliberately NOT name alone — see below. */
function key(name: string, position: string): string {
  const n = name.toLowerCase().replace(/[.,'’]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim()
  return `${n}|${position.toUpperCase().trim()}`
}

/**
 * nflverse positions are finer-grained than ours (SAF/CB/DT/DE vs DB/DL). Collapse
 * both sides onto a shared vocabulary so a defensive back does not fail to match
 * itself.
 */
const POS_GROUP: Record<string, string> = {
  SAF: 'DB', S: 'DB', FS: 'DB', SS: 'DB', CB: 'DB', DB: 'DB',
  DT: 'DL', DE: 'DL', NT: 'DL', DL: 'DL',
  ILB: 'LB', OLB: 'LB', MLB: 'LB', LB: 'LB',
  OT: 'OL', OG: 'OL', C: 'OL', G: 'OL', T: 'OL', OL: 'OL',
  HB: 'RB', FB: 'RB', RB: 'RB', WR: 'WR', TE: 'TE', QB: 'QB', K: 'K', P: 'P', LS: 'LS',
}
const group = (p: string) => POS_GROUP[p.toUpperCase().trim()] ?? p.toUpperCase().trim()

async function fetchCsv(url: string): Promise<string[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const text = url.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8')
  return text.split('\n')
}

async function main() {
  // ── Bridge: our players, keyed by normalised name + position group.
  const ours = await prisma.player.findMany({
    where: { sport: 'NFL' },
    select: { id: true, name: true, position: true },
  })
  const byKey = new Map<string, string>()
  /**
   * Name-only index, used ONLY when the name is unique across our whole player set.
   *
   * ⚠ THIS EXISTS BECAUSE EDGE RUSHERS BREAK THE POSITION JOIN, AND THEY ARE
   * PRECISELY THE PLAYERS THIS MIGRATION IS FOR. The first run missed 394 rows,
   * and the sample was all edge: Cameron Jordan, DeMarcus Lawrence, Preston Smith,
   * Trey Hendrickson — listed LB by one source and DE by the other, so DL vs LB
   * never matched. Losing IDP rows while migrating specifically to gain IDP
   * coverage would have been a quiet, self-defeating hole.
   *
   * ⚠ UNIQUE NAMES ONLY. A bare name fallback would merge the two Josh Allens —
   * the quarterback and the linebacker — which is worse than the miss it fixes.
   * Ambiguous names stay unmatched rather than being guessed.
   */
  const byName = new Map<string, string | null>()
  for (const p of ours) {
    byKey.set(key(p.name, group(p.position)), p.id)
    const nameOnly = key(p.name, '')
    byName.set(nameOnly, byName.has(nameOnly) ? null : p.id)
  }
  const ambiguous = [...byName.values()].filter((v) => v === null).length
  console.log(`our NFL players: ${ours.length} | names shared by 2+ players: ${ambiguous}`)

  for (let season = FROM; season <= TO; season++) {
    console.log(`\n=== ${season} ===`)
    let lines: string[]
    try {
      lines = await fetchCsv(STATS(season))
    } catch (e) {
      console.log(`  unavailable: ${(e as Error).message}`)
      continue
    }

    const h = splitCsv(lines[0])
    const i = (n: string) => h.indexOf(n)
    const iPlayer = i('player_display_name'), iPos = i('position')
    const iSeason = i('season'), iWeek = i('week'), iOpp = i('opponent_team')
    const iTeam = i('recent_team') >= 0 ? i('recent_team') : i('team')
    const iGame = i('game_id')

    if (iPlayer < 0 || iWeek < 0 || iOpp < 0) {
      console.log('  ⚠ shape drift — required columns missing; skipping')
      continue
    }

    // Every non-identity numeric column becomes part of the stat payload, so the
    // scoring engine can price whatever a league configures — including IDP.
    const IDENTITY = new Set([
      'player_id', 'player_name', 'player_display_name', 'position', 'position_group',
      'headshot_url', 'recent_team', 'team', 'season', 'week', 'season_type',
      'opponent_team', 'game_id',
      // ⚠ Excluded deliberately — see the header note on kickers scoring 0.00.
      'fantasy_points', 'fantasy_points_ppr',
    ])

    let matched = 0, unmatched = 0, written = 0
    const rows: Array<Record<string, unknown>> = []
    const unmatchedSample: string[] = []

    for (let k = 1; k < lines.length; k++) {
      const c = splitCsv(lines[k])
      if (c.length < 10) continue
      const name = (c[iPlayer] || '').trim()
      const pos = (c[iPos] || '').trim()
      if (!name) continue

      // Exact (name + position group) first; unique-name fallback only after.
      const ourId = byKey.get(key(name, group(pos))) ?? byName.get(key(name, '')) ?? null
      if (!ourId) {
        unmatched++
        if (unmatchedSample.length < 5) unmatchedSample.push(`${name} (${pos})`)
        continue
      }
      matched++

      const stats: Record<string, number> = {}
      for (let x = 0; x < h.length; x++) {
        if (IDENTITY.has(h[x])) continue
        const v = num(c[x])
        if (v != null && v !== 0) stats[h[x]] = v
      }

      const week = num(c[iWeek])
      if (week == null) continue
      const gameId = (iGame >= 0 ? (c[iGame] || '').trim() : '') || `NFL-${season}-W${String(week).padStart(2, '0')}`

      rows.push({
        playerId: ourId,
        gameId,
        season: num(c[iSeason]) ?? season,
        week,
        opponent: (c[iOpp] || '').trim().toUpperCase() || null,
        team: iTeam >= 0 ? (c[iTeam] || '').trim().toUpperCase() || null : null,
        stats,
      })
    }

    const coverage = matched / Math.max(matched + unmatched, 1)
    console.log(`  rows: ${matched + unmatched} | matched ${matched} | unmatched ${unmatched} | coverage ${(coverage * 100).toFixed(1)}%`)
    if (unmatchedSample.length) console.log(`  unmatched sample: ${unmatchedSample.join(', ')}`)

    if (coverage < MIN_JOIN_COVERAGE) {
      console.error(`\n⚠ JOIN COVERAGE ${(coverage * 100).toFixed(1)}% IS BELOW THE ${MIN_JOIN_COVERAGE * 100}% FLOOR.`)
      console.error('Refusing to write a partial season — a silent join hole surfaces later as a player worth zero.')
      process.exit(1)
    }

    for (const r of rows) {
      await prisma.playerGameStat.upsert({
        where: {
          playerId_sportType_gameId: {
            playerId: r.playerId as string,
            sportType: 'NFL',
            gameId: r.gameId as string,
          },
        },
        update: {
          season: r.season as number,
          weekOrRound: r.week as number,
          statPayload: r.stats as object,
          normalizedStatMap: r.stats as object,
          opponent: (r.opponent as string) ?? undefined,
          team: (r.team as string) ?? undefined,
          source: 'nflverse',
          updatedAt: new Date(),
        },
        create: {
          playerId: r.playerId as string,
          sportType: 'NFL',
          gameId: r.gameId as string,
          season: r.season as number,
          weekOrRound: r.week as number,
          statPayload: r.stats as object,
          normalizedStatMap: r.stats as object,
          // ⚠ fantasyPoints stays 0 here ON PURPOSE. Points are league-specific and
          // computed by leagueScoring.ts from the raw stats above; storing a
          // single "fantasy points" number would bake one league's rules into a
          // shared row.
          fantasyPoints: 0,
          opponent: (r.opponent as string) ?? null,
          team: (r.team as string) ?? null,
          source: 'nflverse',
        },
      })
      written++
    }
    console.log(`  wrote ${written} rows`)
  }

  const total = await prisma.playerGameStat.count({ where: { source: 'nflverse' } })
  console.log(`\nPlayerGameStat rows sourced from nflverse: ${total}`)
  console.log('\n⚠ ATTRIBUTION IS A CC-BY OBLIGATION, NOT A COURTESY — the app must')
  console.log('   credit nflverse wherever this data is surfaced.')
  process.exit(0)
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
