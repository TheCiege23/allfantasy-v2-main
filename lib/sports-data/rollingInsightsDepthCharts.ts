import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'
import { riSupports } from '@/lib/sports-data/rollingInsightsSupport'

/**
 * Depth charts for every sport Rolling Insights serves them for — MLB, NFL, NBA, NHL.
 *
 * WHY A SECOND DEPTH-CHART PATH EXISTS. `syncNFLDepthChartsToDb` in `lib/rolling-insights.ts`
 * reads the vendor's **GraphQL** `nflTeams { rosterByPosition { … } }` query with a hand-written
 * list of 30 NFL position keys. That query is NFL-shaped by construction: there is no documented
 * `mlbTeams`/`nbaTeams`/`nhlTeams` equivalent, and even if there were, the position keys differ
 * per sport. Extending it would mean guessing a GraphQL schema.
 *
 * The REST endpoint `/depth-charts/{SPORT}` IS documented for all four sports
 * (`support_matrix.depth_charts`), so this module uses that instead and leaves the NFL GraphQL
 * path untouched — the two write different `source` values, so they coexist rather than fight
 * over the `(sport, team, position, source)` upsert key.
 *
 * ⚠ THE RESPONSE SHAPE IS UNVERIFIED AND THE PARSER SAYS SO. `contracts/rolling-insights/GAPS.md`
 * records `G-07: /depth-charts field list — all sports — UNVERIFIED`. The only committed hint is
 * the NFL field map's `depthPositionKey: '<team>.<position_key>'` and
 * `depthRankKey: '<team>.<position_key>.<rank_key>'`, which says positions hang off the team
 * object but not whether each bucket is an array or a rank-keyed object. So the parser accepts
 * BOTH and reports `unrecognisedKeys` rather than silently dropping a shape it did not expect.
 * Per CLAUDE.md this is not a licence to probe: if the counter is non-zero, capture a fixture via
 * `contracts/rolling-insights/scripts/probe.sh` and commit it in the same change.
 */

const SOURCE = 'rolling_insights_rest'
const TTL_MS = 12 * 60 * 60 * 1000

/** Team-level keys that describe the team itself, never a position bucket. */
const TEAM_META_KEYS = new Set([
  'team',
  'team_id',
  'teamid',
  'team_name',
  'abbrv',
  'abbreviation',
  'mascot',
  'city',
  'state',
  'conf',
  'conference',
  'division',
  'division_name',
  'img',
  'logo',
  'record',
  'bye',
])

export interface DepthChartPlayer {
  id: string | null
  player: string
  position: string
  /** Depth order within the position, 1-based, when the payload states one. */
  rank: number | null
  status: string | null
  number: number | null
}

export interface DepthChartTeam {
  team: string
  teamId: string | null
  positions: Record<string, DepthChartPlayer[]>
}

const str = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).trim()
  return t.length > 0 && t.toLowerCase() !== 'null' ? t : null
}

const intOf = (v: unknown): number | null => {
  const s = str(v)
  if (!s) return null
  const n = Number.parseInt(s.replace(/[^0-9-]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/** One player entry, from either an array element or a rank-keyed object value. */
function normalizePlayer(raw: unknown, position: string, rankHint: number | null): DepthChartPlayer | null {
  const obj = asRecord(raw)
  if (!obj) {
    // Some buckets are plain name strings. A name alone is still a real depth entry.
    const name = str(raw)
    return name ? { id: null, player: name, position, rank: rankHint, status: null, number: null } : null
  }

  const player = str(obj.player ?? obj.name ?? obj.full_name ?? obj.player_name)
  if (!player) return null

  return {
    id: str(obj.id ?? obj.player_id ?? obj.playerId ?? obj.player_ID),
    player,
    position: str(obj.position) ?? position,
    rank: intOf(obj.rank ?? obj.depth ?? obj.depth_chart_order ?? obj.order) ?? rankHint,
    status: str(obj.status ?? obj.injury_status),
    number: intOf(obj.number ?? obj.jersey ?? obj.jersey_number),
  }
}

/** Turn one position bucket into players, accepting an array OR a rank-keyed object. */
function normalizeBucket(position: string, bucket: unknown): DepthChartPlayer[] {
  if (Array.isArray(bucket)) {
    return bucket
      .map((entry, i) => normalizePlayer(entry, position, i + 1))
      .filter((p): p is DepthChartPlayer => p != null)
  }
  const obj = asRecord(bucket)
  if (!obj) return []
  // Rank-keyed: { "1": {...}, "2": {...} } — the `depthRankKey` shape in the field map.
  return Object.entries(obj)
    .map(([rankKey, entry]) => normalizePlayer(entry, position, intOf(rankKey)))
    .filter((p): p is DepthChartPlayer => p != null)
}

export interface NormalizedDepthCharts {
  teams: DepthChartTeam[]
  /**
   * Team-level keys that were neither recognised team metadata nor parseable as a position
   * bucket. Non-zero means the payload has a shape this parser does not model — the signal that
   * `G-07` needs a committed fixture, not that the feed is empty.
   */
  unrecognisedKeys: string[]
}

/** Pure: flatten team blocks into per-position player lists. Exported for tests. */
export function normalizeRiDepthCharts(rows: unknown[]): NormalizedDepthCharts {
  const teams: DepthChartTeam[] = []
  const unrecognised = new Set<string>()

  for (const row of rows) {
    const block = asRecord(row)
    if (!block) continue

    const teamName =
      str(block.team) ?? str(block.team_name) ?? str(block.abbrv) ?? str(block.abbreviation)
    if (!teamName) continue
    const teamId = str(block.team_id ?? block.teamId ?? block.team_ID)

    const positions: Record<string, DepthChartPlayer[]> = {}
    for (const [key, value] of Object.entries(block)) {
      if (TEAM_META_KEYS.has(key.toLowerCase())) continue
      if (value == null) continue

      const players = normalizeBucket(key, value)
      if (players.length > 0) {
        positions[key] = players
        continue
      }
      // A scalar under an unknown key is metadata we simply do not model; only flag containers,
      // which are what a missed position bucket would look like.
      if (Array.isArray(value) || asRecord(value)) unrecognised.add(key)
    }

    if (Object.keys(positions).length > 0) {
      teams.push({ team: teamName, teamId, positions })
    }
  }

  return { teams, unrecognisedKeys: [...unrecognised] }
}

export interface DepthChartSyncResult {
  sport: string
  teams: number
  /** `depth_charts` rows upserted — one per (team, position). */
  written: number
  players: number
  unsupported: boolean
  notModified: boolean
  unrecognisedKeys: string[]
  errors: string[]
}

/**
 * Fetch + persist depth charts for one sport into `depth_charts`.
 *
 * Writes `source: 'rolling_insights_rest'`, deliberately distinct from the NFL GraphQL writer's
 * `'rolling_insights'`. The unique key is (sport, team, position, source), so running both for
 * NFL yields two coexisting views rather than one clobbering the other, and any reader that wants
 * only the richer NFL GraphQL view can still filter on source.
 */
export async function syncRollingInsightsDepthChartsToDb(opts: {
  sport: string
  season?: string | number
  fetchImpl?: typeof fetch
  now?: Date
}): Promise<DepthChartSyncResult> {
  const sport = opts.sport.trim().toUpperCase()
  const result: DepthChartSyncResult = {
    sport,
    teams: 0,
    written: 0,
    players: 0,
    unsupported: false,
    notModified: false,
    unrecognisedKeys: [],
    errors: [],
  }

  if (!riSupports('depth_charts', sport)) {
    result.unsupported = true
    result.errors.push(`Rolling Insights documents no depth-charts feed for ${sport}`)
    return result
  }

  const { rows, notModified, unsupported, error } = await riFetchRows('depth_charts', {
    sport,
    fetchImpl: opts.fetchImpl,
  })
  result.notModified = notModified
  result.unsupported = unsupported
  if (error) result.errors.push(`depth-charts: ${error}`)
  if (rows.length === 0) return result

  const normalized = normalizeRiDepthCharts(rows)
  result.teams = normalized.teams.length
  result.unrecognisedKeys = normalized.unrecognisedKeys

  const now = opts.now ?? new Date()
  const expiresAt = new Date(now.getTime() + TTL_MS)
  const season = opts.season != null ? String(opts.season) : String(now.getUTCFullYear())

  for (const team of normalized.teams) {
    // NFL is the only sport `normalizeTeamAbbrev` knows; every other sport echoes the provider's
    // own team string, which is what keeps this row joinable to SportsPlayer.team for that sport.
    const teamKey = normalizeTeamAbbrev(team.team) ?? team.team

    for (const [position, players] of Object.entries(team.positions)) {
      if (players.length === 0) continue
      try {
        await prisma.depthChart.upsert({
          where: { sport_team_position_source: { sport, team: teamKey, position, source: SOURCE } },
          update: {
            teamId: team.teamId,
            players: players as unknown as object,
            season,
            fetchedAt: now,
            expiresAt,
          },
          create: {
            sport,
            team: teamKey,
            teamId: team.teamId,
            position,
            players: players as unknown as object,
            source: SOURCE,
            season,
            fetchedAt: now,
            expiresAt,
          },
        })
        result.written += 1
        result.players += players.length
      } catch (e) {
        if (result.errors.length < 10) {
          result.errors.push(
            `upsert ${teamKey}/${position}: ${e instanceof Error ? e.message : String(e)}`,
          )
        }
      }
    }
  }

  return result
}
