/**
 * Soccer season lines, built from per-game rows — the shape `writeAfProjectionSnapshots` reads for every
 * other sport, so soccer goes through the same projection pipeline instead of a second one. PURE.
 *
 * WHY. The vendor serves no soccer season stat lines (`fantasy_stat_lines` holds none), so the projection
 * writer threw "no fantasy_stat_lines found for sport=SOCCER" on every run — 15 of 15 in the fortnight
 * to 2026-10-09 — and soccer had no projections at all. The per-game rows DO exist: the multi-sport
 * ingest writes one `player_game_stats` row per player per match (EPL, La Liga, Serie A; 4,159 rows,
 * 1,256 players by 2026-10-09), and `normalizeSoccerGameStats` already reads them for weekly scoring.
 *
 * Each line is what a season stat line would hold, in the ENGINE's keys (`goals`, `assists`,
 * `clean_sheet_def`, `saves`, … — lib/sportConfig/configs/soccer.ts), so the stored `perGameRates` are
 * rescoreable against any league's soccer settings:
 *
 *   { riTeam, position, riPlayerName, regular_season: { games_played, <engine key>: season total, … } }
 *
 * The rules, each read off the normalizer rather than restated here:
 *   - A GAME IS AN APPEARANCE. A row with no minutes is an unused substitute — not a game played, and
 *     counting it would dilute every rate. `games_played` counts appearances only.
 *   - A clean sheet needs 60 minutes (the normalizer's rule), so a 90th-minute substitute's does not count.
 *   - A row whose group the normalizer cannot tell (fielders / goalkeepers) is dropped, never guessed.
 *   - POSITION is the one the rows give most often (`Defender` → DEF, …); TEAM is the latest row's, the
 *     club he plays for now.
 *
 * ⚠ RATES ARE PER APPEARANCE, NOT PER CLUB MATCH. A rotation player who appeared in four of six matches
 * carries his per-appearance line; anything that values the rest of a season must scale him by his share
 * of his club's matches (his appearances over the matches his club has rows for), exactly as baseball
 * scales a pitcher (`lib/decision-os/trade/mlbTeamGame.ts`).
 */
import { normalizeSoccerGameStats } from '@/lib/scoring-runtime/soccerStatNormalization'

export type SoccerGameRow = {
  playerId: string
  team: string | null
  gameDate: Date | null
  normalizedStatMap: unknown
}

export type SoccerSeasonLine = {
  playerId: string
  season: string
  stats: {
    riTeam: string | null
    position: string | null
    riPlayerName: string | null
    regular_season: Record<string, number>
  }
}

const POSITION: Readonly<Record<string, string>> = {
  goalkeeper: 'GK',
  defender: 'DEF',
  midfielder: 'MID',
  forward: 'FWD',
}

function positionOf(map: unknown): string | null {
  const raw = map && typeof map === 'object' ? (map as Record<string, unknown>).position : null
  return typeof raw === 'string' ? POSITION[raw.trim().toLowerCase()] ?? null : null
}

export function soccerSeasonLines(
  rows: readonly SoccerGameRow[],
  namesById: ReadonlyMap<string, string>,
  season: number,
): SoccerSeasonLine[] {
  type Acc = { totals: Record<string, number>; appearances: number; positions: Map<string, number>; team: string | null; latest: number }
  const byPlayer = new Map<string, Acc>()
  for (const row of rows) {
    const { stats } = normalizeSoccerGameStats(row.normalizedStatMap)
    if (!stats.appearance) continue
    const acc: Acc = byPlayer.get(row.playerId) ?? { totals: {}, appearances: 0, positions: new Map(), team: null, latest: -Infinity }
    acc.appearances += 1
    for (const [k, v] of Object.entries(stats)) acc.totals[k] = (acc.totals[k] ?? 0) + v
    const pos = positionOf(row.normalizedStatMap)
    if (pos) acc.positions.set(pos, (acc.positions.get(pos) ?? 0) + 1)
    const when = row.gameDate?.getTime() ?? -Infinity
    if (when >= acc.latest) {
      acc.latest = when
      acc.team = row.team ?? acc.team
    }
    byPlayer.set(row.playerId, acc)
  }

  const out: SoccerSeasonLine[] = []
  for (const [playerId, acc] of byPlayer) {
    const position = [...acc.positions].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    out.push({
      playerId,
      season: String(season),
      stats: {
        riTeam: acc.team,
        position,
        riPlayerName: namesById.get(playerId) ?? null,
        // `appearance` is the count itself; as a component it would only restate games_played.
        regular_season: { games_played: acc.appearances, ...withoutKey(acc.totals, 'appearance') },
      },
    })
  }
  return out
}

function withoutKey(record: Record<string, number>, key: string): Record<string, number> {
  const { [key]: _drop, ...rest } = record
  return rest
}
