import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { riFetch } from '@/lib/workers/providers/rollingInsightsRest'
import { riSupports } from '@/lib/sports-data/rollingInsightsSupport'
import { getRollingInsightsSportCode } from '@/lib/providers/rollingInsightsFieldMaps'

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

/** True for a key that can only be a provider id, never a team name. */
const isIdLike = (k: string) => /^\d+$/.test(k.trim())

/**
 * Pure: unwrap a `/depth-charts/{SPORT}` body into team blocks, KEEPING the team when it is a map key.
 *
 * 🛑 WHY THIS IS NOT `resolveRiEnvelope`. The field map documents depth charts as
 * `<team>.<position_key>.<rank_key>` — the TEAM IS THE MAP KEY, not a field on the block. The
 * generic envelope helper turns an object map into `Object.values(...)`, which throws the keys
 * away, and `normalizeRiDepthCharts` then skips every block for having no team name. That is
 * exactly what production reported for NBA, NHL and MLB on every weekly run since this path
 * shipped: HTTP 200, `teams: 0`, no error, no `unrecognisedKeys` — and not one
 * `rolling_insights_rest` row in `depth_charts`.
 *
 * Accepts, in order: `data.<CODE>` or bare `data` (or the root), each as an array of team blocks
 * or as a map of team key -> block. A block that already names its team is left untouched; a
 * numeric key is kept as `team_id`, since it cannot be a name. G-07 still holds: this widens what
 * is ACCEPTED, it does not verify the shape — see `describeDepthChartPayload`.
 */
export function extractRiDepthChartTeamBlocks(payload: unknown, sport: string): unknown[] {
  const root = asRecord(payload)
  if (!root) return Array.isArray(payload) ? payload : []
  const data = root.data ?? root
  if (Array.isArray(data)) return data
  const bag = asRecord(data)
  if (!bag) return []

  const code = getRollingInsightsSportCode(sport)
  const inner = bag[code] ?? bag[sport.toUpperCase()] ?? bag
  if (Array.isArray(inner)) return inner
  const map = asRecord(inner)
  if (!map) return []

  const blocks: unknown[] = []
  for (const [key, value] of Object.entries(map)) {
    if (Array.isArray(value)) {
      // A list under a key: either the team list itself, or one team's players. Only the first
      // can be a block list, and only when its entries are objects carrying a team.
      if (value.some((v) => asRecord(v) && (asRecord(v)!.team ?? asRecord(v)!.team_name))) blocks.push(...value)
      continue
    }
    const block = asRecord(value)
    if (!block) continue
    const named = block.team ?? block.team_name ?? block.abbrv ?? block.abbreviation
    if (named != null) blocks.push(block)
    else if (isIdLike(key)) blocks.push({ team_id: key, ...block })
    else blocks.push({ team: key, ...block })
  }
  return blocks
}

/**
 * Pure: the payload's SHAPE — key names and value kinds, never a value. Attached to a run whose
 * 200 parsed to zero teams, so the next weekly fire says what the vendor actually sent instead of
 * another silent zero. Keys here are team and position names; no credential can reach them.
 */
export function describeDepthChartPayload(payload: unknown, sport: string): Record<string, unknown> {
  const kind = (v: unknown) => (Array.isArray(v) ? `array(${v.length})` : v === null ? 'null' : typeof v)
  const keysOf = (v: unknown) => (asRecord(v) ? Object.keys(asRecord(v)!).slice(0, 12) : [])
  const root = asRecord(payload)
  const data = root ? (root.data ?? root) : payload
  const code = getRollingInsightsSportCode(sport)
  const inner = asRecord(data)?.[code]
  const level = inner ?? data
  const firstKey = keysOf(level)[0]
  const first = Array.isArray(level) ? level[0] : firstKey != null ? asRecord(level)![firstKey] : undefined
  return {
    root: kind(payload),
    rootKeys: keysOf(payload),
    data: kind(data),
    dataKeys: keysOf(data),
    sportKey: inner === undefined ? null : `${code}: ${kind(inner)}`,
    firstEntryKey: firstKey ?? null,
    firstEntry: kind(first),
    firstEntryKeys: keysOf(first),
  }
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
  /** Present only when a 200 parsed to zero teams: the payload's key layout, no values. */
  shapeHint?: Record<string, unknown>
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

  const outcome = await riFetch('depth_charts', { sport, fetchImpl: opts.fetchImpl })
  if (!outcome.ok) {
    result.notModified = outcome.kind === 'not_modified'
    result.unsupported = outcome.kind === 'unsupported'
    // The transport already strips the token from every error it builds.
    result.errors.push(`depth-charts: ${outcome.error}`)
    return result
  }

  const rows = extractRiDepthChartTeamBlocks(outcome.payload, sport)
  const normalized = normalizeRiDepthCharts(rows)
  result.teams = normalized.teams.length
  result.unrecognisedKeys = normalized.unrecognisedKeys
  if (normalized.teams.length === 0) {
    result.shapeHint = describeDepthChartPayload(outcome.payload, sport)
    return result
  }

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
