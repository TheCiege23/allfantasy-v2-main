import 'server-only'

import { prisma } from '@/lib/prisma'
import { toPrismaJsonInput } from '@/lib/prisma-json'
import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'
import { RI_SOCCER_LEAGUES, riSupports } from '@/lib/sports-data/rollingInsightsSupport'
import { getRollingInsightsSportCode } from '@/lib/providers/rollingInsightsFieldMaps'
import type { RollingInsightsSoccerLeagueCode } from '@/lib/providers/rollingInsightsSoccerLeague'

/**
 * Per-game player box lines for every sport, from Rolling Insights `/live/{date}/{SPORT}`.
 *
 * WHY THIS EXISTS. `player_game_stats` held 252,768 rows on production 2026-08-27 and every one
 * of them was NFL, because the only writer — `lib/player-game-stats/importPlayerGameStats.ts` —
 * reads **Sleeper**, which serves NFL and nothing else. So "historical data" existed for one
 * sport out of seven, and every feature built on game logs (opponent adjustments, month-of-season
 * effects, the projection engine's weekly observations, matchup history) was NFL-only by
 * construction rather than by design.
 *
 * `/live/{date}/{SPORT}` is the vendor's PRIMARY game-day endpoint and it "returns started AND
 * finished events for the given date" — which makes it a historical source as well as a live one.
 * Walking a date range is therefore a backfill, and the same call on today's date is the live
 * tick. One parser serves both.
 *
 * ⚠ WHAT THIS DELIBERATELY DOES NOT DO: SCORE. `fantasyPoints` is left at the column default of 0
 * and `normalizedStatMap.scored` is set to `false`. Zero here means NOT SCORED, not "scored
 * zero" — a distinction that matters because `scoring_templates` is EMPTY in production, so there
 * is no per-sport scoring basis to apply and inventing one would put fabricated numbers in a
 * column the product labels fantasy points. Scoring is the engine's job, against a real league's
 * settings. Consumers must gate on `normalizedStatMap.scored` before reading `fantasyPoints` from
 * a row whose `source` is this module.
 *
 * ⚠ FIELD CONFIDENCE VARIES ENORMOUSLY BY SPORT AND IS RECORDED PER ROW. The contract rates NFL
 * `high`, NBA and MLB `low`, SOCCER `very_low`, and NHL / NCAAFB / NCAABB `none` — the last three
 * meaning the vendor's live field names are simply not documented. That is why the payload is
 * stored VERBATIM in `statPayload` and only recognised numeric fields are flattened into
 * `normalizedStatMap`: a field we cannot name is still preserved, and nothing is guessed.
 */

const SOURCE = 'rolling_insights_live'

/** `fields.<SPORT>.confidence` from ENDPOINTS.yaml, as a 0-1 score written to every row. */
const FIELD_CONFIDENCE: Record<string, number> = {
  NFL: 0.9,
  NBA: 0.4,
  MLB: 0.4,
  SOCCER: 0.2,
  NHL: 0.1,
  NCAAFB: 0.1,
  NCAABB: 0.1,
}

/** Team/opponent columns are `@db.VarChar(8)`; a full club name would blow the insert. */
const TEAM_CODE_MAX = 8

const str = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).trim()
  return t.length > 0 && t.toLowerCase() !== 'null' ? t : null
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}


/** Leading 4-digit year of a season label: "2025-2026" -> 2025, "2025" -> 2025. */
function seasonStartYearLocal(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const m = /^(\d{4})/.exec(String(v ?? '').trim())
  return m ? Number(m[1]) : null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** Bound a team code to the column width without silently producing two identical codes. */
function teamCode(raw: unknown): string | null {
  const s = str(raw)
  if (!s) return null
  return s.length <= TEAM_CODE_MAX ? s : s.slice(0, TEAM_CODE_MAX)
}

export interface RiBoxLine {
  providerPlayerId: string
  playerName: string | null
  /** Which sub-box it came from: `batting`, `pitching`, `skaters`, `goalies`, or `all`. */
  group: string
  team: string | null
  opponent: string | null
  raw: Record<string, unknown>
}

export interface RiGameBox {
  providerGameId: string
  season: number | null
  weekOrRound: number
  gameDate: Date | null
  status: string | null
  lines: RiBoxLine[]
}

/**
 * Pull player box lines out of one `/live` game object.
 *
 * ⚠ THE SHAPE BELOW IS MEASURED, NOT INFERRED — see `fixtures/live.MLB.json`, captured
 * 2026-08-26 via `scripts/probe.sh`. The first version of this parser was written from the NBA
 * hint in `rollingInsightsFieldMaps` (`playerBox: 'player_box'` under the team shell) and got
 * three things wrong at once, which is why it found ZERO games on dates that had fifteen:
 *
 *   1. `player_box` sits at the GAME ROOT, a sibling of `full_box` — not inside the team node.
 *   2. Below it the split is `away_team` / `home_team`, then the GROUP (`batting`, `pitching`).
 *   3. The innermost level is an OBJECT KEYED BY PLAYER ID, not an array. The entry itself
 *      carries NO `player_id` field at all, so the old code — which required one — would have
 *      dropped every line even had it found them.
 *
 * Measured shape:
 *   game.player_box.{away_team|home_team}.{batting|pitching}.<PLAYER_ID> = { player, POS, AB, H, … }
 *
 * Team identity still comes from `full_box.<side>_team` (`abbrv`, `team_id`), which is where the
 * fixture confirms it lives.
 *
 * ⚠ NBA AND NHL ARE NOW MEASURED TOO, AND NBA DID NOT MATCH. Probed 2026-03-15 on RSC_TOKEN2
 * (fixtures/live.NBA.json, fixtures/live.NHL.json). NHL nests like MLB — `skaters`/`goalies`
 * where MLB has `batting`/`pitching`. NBA has NO GROUP LEVEL AT ALL: player ids hang straight
 * off the side. Against the real fixtures this parser extracted 38 NHL lines and **0 NBA**,
 * silently, because it read stat NAMES as player ids. Now detected by shape, not by sport.
 *
 * ⚠ NCAAB and NCAAFB live shapes remain UNVERIFIED (GAPS.md G-02/G-03 — seasons out of window).
 * Both the array form and the id-keyed object form are still accepted, and an array entry may
 * carry its own `player_id`. Do not narrow this until each has its own committed fixture.
 */
export function normalizeRiGameBox(game: unknown): RiGameBox | null {
  const g = asRecord(game)
  if (!g) return null

  const providerGameId = str(g.game_ID ?? g.game_id ?? g.gameId)
  if (!providerGameId) return null

  const fullBox = asRecord(g.full_box)
  // Root first (measured), team node second (the shape other sports might still use).
  const playerBox = asRecord(g.player_box) ?? asRecord(fullBox?.player_box)

  const sides: Array<{ key: 'home_team' | 'away_team'; other: 'home_team' | 'away_team' }> = [
    { key: 'home_team', other: 'away_team' },
    { key: 'away_team', other: 'home_team' },
  ]

  const lines: RiBoxLine[] = []
  for (const side of sides) {
    const teamNode = asRecord(fullBox?.[side.key])
    const otherNode = asRecord(fullBox?.[side.other])

    // `abbrv` off full_box is the measured source. The root carries `<side>_team_name` (a full
    // club name, hence the VarChar(8) bounding) as a fallback only.
    const team =
      teamCode(teamNode?.abbrv ?? teamNode?.abbreviation) ?? teamCode(g[`${side.key}_name`])
    const opponent =
      teamCode(otherNode?.abbrv ?? otherNode?.abbreviation) ?? teamCode(g[`${side.other}_name`])

    const sideBox = asRecord(playerBox?.[side.key]) ?? asRecord(teamNode?.player_box)
    if (!sideBox) continue

    for (const [group, bucket] of Object.entries(sideBox)) {
      // Array form: each entry must identify itself.
      if (Array.isArray(bucket)) {
        for (const entry of bucket) {
          const p = asRecord(entry)
          if (!p) continue
          const providerPlayerId = str(p.player_id ?? p.playerId ?? p.player_ID)
          if (!providerPlayerId) continue
          lines.push({
            providerPlayerId,
            playerName: str(p.player ?? p.name),
            group,
            team,
            opponent,
            raw: p,
          })
        }
        continue
      }

      const byId = asRecord(bucket)
      if (!byId) continue

      /*
       * 🛑 NOT EVERY SPORT HAS A GROUP LEVEL, AND ASSUMING ONE SILENTLY DROPPED ALL OF NBA.
       *
       * MLB nests `batting`/`pitching` and NHL nests `skaters`/`goalies`, so for those the loop
       * above is a GROUP and the level below is the player map. NBA hangs player ids straight
       * off the side, so for NBA this level IS the player and the level below is stat NAMES —
       * `asRecord('A Player')` is null, every entry is skipped, and the game yields no lines.
       *
       * Measured against the committed fixtures (probe 2026-03-15):
       *     fixtures/live.NBA.json  ->  0 lines extracted   (silently)
       *     fixtures/live.NHL.json  -> 38 lines extracted
       * Nothing failed; NBA simply never produced a row. The `group` field's own doc comment
       * already allowed `'all'` for this case — the shape was anticipated and never handled.
       *
       * Detect by SHAPE rather than by sport: a group's values are records, a player line's
       * values are scalars. A sport switch here would need editing for the next feed.
       */
      const looksGrouped = Object.values(byId).some((v) => asRecord(v) !== null)
      if (!looksGrouped) {
        const providerPlayerId = str(byId.player_id ?? byId.playerId ?? byId.player_ID) ?? str(group)
        if (!providerPlayerId) continue
        lines.push({
          providerPlayerId,
          playerName: str(byId.player ?? byId.name),
          group: 'all',
          team,
          opponent,
          raw: { player_id: providerPlayerId, ...byId },
        })
        continue
      }

      // Grouped form: the KEY is the player id and the entry carries no id of its own.
      for (const [playerId, entry] of Object.entries(byId)) {
        const p = asRecord(entry)
        if (!p) continue
        const providerPlayerId = str(p.player_id ?? p.playerId ?? p.player_ID) ?? str(playerId)
        if (!providerPlayerId) continue
        lines.push({
          providerPlayerId,
          playerName: str(p.player ?? p.name),
          group,
          team,
          opponent,
          // The id is the KEY, so it is folded into the stored payload — otherwise the row's own
          // provenance would be missing from `statPayload`.
          raw: { player_id: providerPlayerId, ...p },
        })
      }
    }
  }

  const gameTime = str(g.game_time ?? g.gameTime)
  const parsedDate = gameTime ? new Date(gameTime) : null

  return {
    providerGameId,
    // `/live` returns a hyphenated SPAN for sports whose season crosses a calendar year
    // ("2025-2026" for NBA and NHL, measured 2026-03-15). `num()` gives NaN -> null on
    // those, so this field was silently null for exactly the sports being added and the
    // caller fell back to a guessed season. The vendor contract settles the rule:
    // `season: { format: "YYYY", note: "Year season started." }`.
    // ⚠ DUPLICATES `lib/sports-data/seasonLabel.ts`, which is not on main yet (p1b, queued).
    //   Collapse into that helper once it lands — two implementations of one rule is the bug.
    season: seasonStartYearLocal(g.season),
    // Football carries a real week; the daily sports do not, and 0 is this column's documented
    // "no week" value rather than a made-up round number.
    weekOrRound: num(g.week) ?? 0,
    gameDate: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null,
    status: str(g.status ?? g.game_status),
    lines,
  }
}

/** Flatten the recognised numeric fields; everything else stays in `statPayload` verbatim. */
function normalizedMapFor(line: RiBoxLine): Record<string, unknown> {
  const stats: Record<string, number> = {}
  for (const [key, value] of Object.entries(line.raw)) {
    const n = num(value)
    if (n != null) stats[key] = n
  }
  return {
    group: line.group,
    position: str(line.raw.position ?? line.raw.POS) ?? null,
    positionCategory: str(line.raw.position_category) ?? null,
    status: str(line.raw.status) ?? null,
    stats,
    /**
     * ⚠ READ THIS BEFORE READING `fantasyPoints`. False means the row was never scored, and the
     * 0 in that column is the schema default, not a measurement. See the module header.
     */
    scored: false,
  }
}

export interface GameLogIngestResult {
  sport: string
  datesRequested: number
  datesFetched: number
  games: number
  lines: number
  written: number
  /** Box lines whose provider player id has no PlayerIdentityMap row — NOT written. */
  unresolved: number
  notModifiedDates: string[]
  unsupported: boolean
  errors: string[]
}

function leaguesFor(sport: string): Array<RollingInsightsSoccerLeagueCode | undefined> {
  return getRollingInsightsSportCode(sport) === 'SOCCER' ? [...RI_SOCCER_LEAGUES] : [undefined]
}

/** `YYYY-MM-DD` strings from `from` to `to` inclusive, oldest first. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  const start = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/**
 * Ingest player box lines for a list of dates into `player_game_stats`.
 *
 * UNRESOLVED LINES ARE DROPPED, NOT STORED UNDER A PROVIDER ID. `PlayerGameStat.playerId` is half
 * the unique key and every reader joins on it, so a row keyed by a provider id joins to nothing
 * while looking like data. This repo has shipped that failure before; the count is returned
 * instead, and a high one means `PlayerIdentityMap` needs another backfill pass — not that the
 * provider is down.
 */
export async function ingestRollingInsightsGameLogs(opts: {
  sport: string
  /** `YYYY-MM-DD` dates to sweep, oldest first. */
  dates: string[]
  fetchImpl?: typeof fetch
  now?: Date
  /** Checked BETWEEN dates so a bounded run makes progress instead of hitting the edge. */
  shouldStop?: () => boolean
}): Promise<GameLogIngestResult> {
  const sport = opts.sport.trim().toUpperCase()
  const vendorCode = getRollingInsightsSportCode(sport)
  const result: GameLogIngestResult = {
    sport,
    datesRequested: opts.dates.length,
    datesFetched: 0,
    games: 0,
    lines: 0,
    written: 0,
    unresolved: 0,
    notModifiedDates: [],
    unsupported: false,
    errors: [],
  }

  if (!riSupports('live', sport)) {
    result.unsupported = true
    result.errors.push(`Rolling Insights documents no live feed for ${sport}`)
    return result
  }

  // One identity lookup for the whole sweep. The map is small (thousands of rows per sport) and
  // re-querying per game would dominate the run.
  const identityByRiId = new Map<string, string>()
  try {
    const rows = await prisma.playerIdentityMap.findMany({
      where: { sport, rollingInsightsId: { not: null } },
      select: { id: true, rollingInsightsId: true },
    })
    for (const r of rows) {
      if (r.rollingInsightsId) identityByRiId.set(r.rollingInsightsId, r.id)
    }
  } catch (e) {
    result.errors.push(`identity map load failed: ${e instanceof Error ? e.message : String(e)}`)
    return result
  }
  if (identityByRiId.size === 0) {
    result.errors.push(
      'identity map has no rollingInsightsId rows for this sport — refusing to write provider-keyed game logs',
    )
    return result
  }

  const now = opts.now ?? new Date()
  const confidence = FIELD_CONFIDENCE[vendorCode] ?? 0.1
  const fallbackSeason = now.getUTCMonth() + 1 >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1

  for (const date of opts.dates) {
    if (opts.shouldStop?.()) break

    for (const league of leaguesFor(sport)) {
      const { rows, notModified, error } = await riFetchRows('live', {
        sport,
        date,
        league,
        fetchImpl: opts.fetchImpl,
      })
      if (notModified) {
        // Recorded per date rather than collapsed into "no games". A 304 that survived the retry
        // means unchanged-or-empty, and writing an emptiness for a date that may have had games
        // is the failure mode CLAUDE.md singles out.
        result.notModifiedDates.push(league ? `${date}:${league}` : date)
        continue
      }
      if (error) {
        result.errors.push(`live ${date}${league ? `/${league}` : ''}: ${error}`)
        continue
      }
      result.datesFetched += 1

      for (const rawGame of rows) {
        const box = normalizeRiGameBox(rawGame)
        if (!box || box.lines.length === 0) continue
        result.games += 1
        result.lines += box.lines.length

        for (const line of box.lines) {
          const playerId = identityByRiId.get(line.providerPlayerId)
          if (!playerId) {
            result.unresolved += 1
            continue
          }

          // The sub-box name is part of the game key: an MLB two-way player appears in BOTH
          // `batting` and `pitching` for the same game, and a bare game id would make the second
          // write overwrite the first.
          const gameId = line.group === 'all' ? box.providerGameId : `${box.providerGameId}:${line.group}`

          const data = {
            providerPlayerId: line.providerPlayerId,
            providerGameId: box.providerGameId,
            season: box.season ?? fallbackSeason,
            weekOrRound: box.weekOrRound,
            statPayload: toPrismaJsonInput(line.raw),
            normalizedStatMap: toPrismaJsonInput(normalizedMapFor(line)),
            source: SOURCE,
            confidence,
            team: line.team,
            opponent: line.opponent,
            gameDate: box.gameDate,
            fetchedAt: now,
          }

          try {
            await prisma.playerGameStat.upsert({
              where: { playerId_sportType_gameId: { playerId, sportType: sport, gameId } },
              update: data,
              create: { playerId, sportType: sport, gameId, ...data },
            })
            result.written += 1
          } catch (e) {
            if (result.errors.length < 10) {
              result.errors.push(
                `upsert ${playerId}/${gameId}: ${e instanceof Error ? e.message : String(e)}`,
              )
            }
          }
        }
      }
    }
  }

  return result
}

/**
 * The most recent `days` dates, newest first.
 *
 * Newest-first because a bounded run should close the freshest gap: yesterday's box scores are
 * what a lineup decision needs tonight, and older dates are still there next run.
 */
export function recentDates(days: number, now = new Date()): string[] {
  const out: string[] = []
  for (let i = 1; i <= days; i += 1) {
    out.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10))
  }
  return out
}
