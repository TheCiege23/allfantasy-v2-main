/**
 * Rolling Insights as a LiveStatsProvider.
 *
 * ⚠ THIS IS A PROVIDER SWAP, NOT A NEW POLLER — AND THAT DISTINCTION SAVED A
 * PARALLEL PIPELINE. The live stack already exists: `live-score-tick` drives
 * runLiveScoringForActiveSeasons, which polls only active games, persists only
 * changed stat lines, rescores only affected matchups and broadcasts over SSE.
 * NflLiveStatsProvider feeds it from `prisma.sportsGame`, filled by the separate
 * import-scores cron from API-Sports. Implementing the same seam means the cron,
 * telemetry, cadence engine, rescore planner and SSE fan-out all come for free.
 *
 * What this adds over the incumbent: PLAYER-LEVEL live stats. The DB path carries
 * team scores; RI's live feed carries per-player box lines, which is what fantasy
 * scoring actually needs.
 *
 * ⚠ USE ROLLING_INSIGHTS_RSC_TOKEN, NOT CLIENT_SECRET2. The latter is the
 * OTHER-SPORTS credential and against NFL it returns 304 forever — which is
 * indistinguishable from "nothing has changed" and will look like a working
 * poller that never emits.
 */

import type {
  LiveGameLite,
  LiveStatsProvider,
  LiveStatsQuery,
} from '@/lib/live-scoring/provider'
import type { LiveGameStatus } from '@/lib/live-scoring/types'
import { normalizeLiveGameStatus } from '@/lib/live-scoring/cadence'
import { liveUrl, parseLivePayload, interpretPollResponse } from './rollingInsightsAdapter'
import type { GameSnapshot } from './eventDetector'
import { prisma } from '@/lib/prisma'

/** Team-defense key convention shared with the incumbent provider. */
const defKey = (team: string) => `nfl:def:${team.toUpperCase()}`

type FetchLike = (url: string) => Promise<{ status: number; json(): Promise<unknown> }>

export class RollingInsightsLiveProvider implements LiveStatsProvider {
  private readonly token: string
  private readonly fetchImpl: FetchLike
  /**
   * Cache of the most recent successful poll, keyed by date.
   *
   * ⚠ THIS IS WHAT MAKES 304 WORTH HONOURING. RI returns 304 when nothing has
   * changed; without a cached previous payload the caller would have to re-fetch
   * with a cache-buster to get any data at all, discarding the entire cost
   * advantage. On 304 we serve the last good snapshot and do no parsing.
   */
  private lastGood = new Map<string, { snapshots: GameSnapshot[]; at: Date }>()

  /**
   * Restrict this provider to a subset of games.
   *
   * ⚠ 'preseason' IS THE SAFE ROLLOUT LANE, AND THE FEED MAKES IT EXACT. Every game
   * carries `season_type` verbatim ("Preseason" | "Regular Season" | "Postseason"),
   * so scoping is a string match rather than a date heuristic that drifts every
   * year. Preseason games are real, live, and score nobody's actual league — which
   * makes them the one place a live-scoring provider can be proven under genuine
   * game conditions without a bad poll costing a user their week.
   *
   * ⚠ FILTERING HERE, NOT AT THE CRON, IS DELIBERATE. If the gate lived upstream,
   * a caller could still reach every method and quietly score a regular-season
   * game through an unproven path. Returning nothing for out-of-scope games makes
   * the restriction total.
   */
  private readonly scope: 'preseason' | 'all'

  constructor(opts: { token?: string; fetchImpl?: FetchLike; scope?: 'preseason' | 'all' } = {}) {
    this.scope = opts.scope ?? 'preseason'
    const token = opts.token ?? process.env.ROLLING_INSIGHTS_RSC_TOKEN?.trim()
    if (!token) {
      throw new Error(
        'ROLLING_INSIGHTS_RSC_TOKEN is not set — CLIENT_SECRET2 is the other-sports token and will 304 against NFL'
      )
    }
    this.token = token
    this.fetchImpl = opts.fetchImpl ?? ((url) => fetch(url) as unknown as ReturnType<FetchLike>)
  }

  /** True when a snapshot is inside this provider's configured scope. */
  private inScope(s: GameSnapshot): boolean {
    if (this.scope === 'all') return true
    return (s.seasonType ?? '').toLowerCase().includes('pre')
  }

  /** Poll one date, honouring 304 by serving the cached snapshots. */
  private async poll(date: string): Promise<GameSnapshot[]> {
    const res = await this.fetchImpl(liveUrl(date, this.token))
    let body: unknown = null
    if (res.status >= 200 && res.status < 300) {
      body = await res.json().catch(() => null)
    }
    const outcome = interpretPollResponse(res.status, body, new Date())

    if (outcome.kind === 'changed') {
      // Scope BEFORE caching, so an out-of-scope game can never be served later
      // from the fallback path either.
      const scoped = outcome.snapshots.filter((s) => this.inScope(s))
      this.lastGood.set(date, { snapshots: scoped, at: new Date() })
      return scoped
    }
    // 'unchanged' (304) and 'error' both fall back to the last good read rather
    // than reporting an empty slate — an empty result would read as "no games"
    // and silently stall scoring.
    return this.lastGood.get(date)?.snapshots ?? []
  }

  /**
   * ⚠ DATE IS DERIVED FROM "NOW", NOT FROM THE WEEK. RI's live endpoint is keyed
   * by calendar date; the orchestrator's query is keyed by season/week. An NFL
   * week spans Thursday to Monday, so a single date cannot cover it — this returns
   * TODAY's games, which is the correct scope for a live tick and wrong for a
   * backfill. Do not reuse this method to reconstruct a whole week.
   */
  async fetchActiveGames(_query: LiveStatsQuery): Promise<LiveGameLite[]> {
    const date = new Date().toISOString().slice(0, 10)
    const snaps = await this.poll(date)
    return snaps.map((s) => {
      // `full_box` carries `abbrv` per side — away first, home second, matching
      // the order the adapter reads them. Real abbreviations, not names guessed
      // into codes.
      const [away, home] = s.teams ?? []
      return {
        gameId: s.gameId,
        homeTeam: home?.team ?? '',
        awayTeam: away?.team ?? '',
        status: this.normalizeGameStatus(s.status),
        startTime: null,
      }
    })
  }

  /**
   * Cached RI-id -> our-player-id map, loaded once per instance.
   *
   * ⚠ THIS TRANSLATION IS THE ONLY THING STANDING BETWEEN THIS PROVIDER AND
   * CREDITING ONE PLAYER'S STATS TO ANOTHER. RI keys players by its own numeric
   * ids, which collide numerically with Sleeper ids while meaning different
   * people: RI 8735 is Ollie Gordon II, our sleeper:8735 is Jairon McVea. Passing
   * RI ids straight through produced a 64% "match rate" against entirely wrong
   * humans — a working-looking join with plausible numbers and no error.
   *
   * The crosswalk is built by NAME and POSITION (never by id), team-disambiguated,
   * and coverage-asserted at 85% before it may be written. See
   * scripts/build-ri-player-crosswalk.ts.
   */
  private crosswalk: Map<string, string> | null = null

  private async loadCrosswalk(): Promise<Map<string, string>> {
    if (this.crosswalk) return this.crosswalk
    const rows = await prisma.playerProviderIdentity.findMany({
      where: { provider: 'rolling_insights', sportKey: 'NFL', playerId: { not: null } },
      select: { providerPlayerId: true, playerId: true },
    })
    this.crosswalk = new Map(rows.map((r) => [r.providerPlayerId, r.playerId as string]))
    return this.crosswalk
  }

  async fetchPlayerStatsForGames(
    query: LiveStatsQuery & { games: readonly LiveGameLite[]; playerIds: readonly string[] }
  ): Promise<Map<string, Record<string, number>>> {
    const [snaps, crosswalk] = await Promise.all([
      this.poll(new Date().toISOString().slice(0, 10)),
      this.loadCrosswalk(),
    ])
    const wanted = new Set(query.playerIds.map(String))
    const gameIds = new Set(query.games.map((g) => g.gameId))

    const out = new Map<string, Record<string, number>>()
    for (const snap of snaps) {
      if (gameIds.size > 0 && !gameIds.has(snap.gameId)) continue
      for (const p of snap.players) {
        /*
         * ⚠ AN UNMAPPED RI PLAYER IS SKIPPED, NEVER PASSED THROUGH UNDER ITS OWN
         * ID. Falling back to the raw id is precisely the bug: it would resolve
         * to a real but different player. Skipping costs a stat line; falling
         * back costs someone's week.
         */
        const ourId = crosswalk.get(p.playerId)
        if (!ourId) continue
        // Scoped to rostered players only — never the whole league.
        if (wanted.size > 0 && !wanted.has(ourId)) continue
        out.set(ourId, p.stats)
      }
    }
    return out
  }

  /**
   * Team-defence lines, keyed `nfl:def:<TEAM>`.
   *
   * ⚠ I PREVIOUSLY RETURNED AN EMPTY MAP HERE AND CALLED IT A MEASURED GAP. It was
   * not — it was an incomplete read. I had inspected `player_box` only and
   * concluded team defence was absent from the feed. It lives in
   * `full_box.team_stats`, alongside `abbrv`, and carries the whole set: sacks,
   * defense_touchdowns, defense_interceptions, defense_fumble_recoveries,
   * safeties, every return-TD variant and points_against_defense_special_teams.
   *
   * The lesson is narrow and worth keeping: "the field is not in the object I
   * looked at" is not the same claim as "the provider does not supply it", and
   * shipping the first as the second would have scored every DST slot at zero
   * behind a comment explaining why that was intentional.
   */
  async fetchTeamDefenseStatsForGames(
    query: LiveStatsQuery & { games: readonly LiveGameLite[] }
  ): Promise<Map<string, Record<string, number>>> {
    const date = new Date().toISOString().slice(0, 10)
    const snaps = await this.poll(date)
    const gameIds = new Set(query.games.map((g) => g.gameId))

    const out = new Map<string, Record<string, number>>()
    for (const snap of snaps) {
      if (gameIds.size > 0 && !gameIds.has(snap.gameId)) continue
      for (const t of snap.teams ?? []) {
        out.set(defKey(t.team), t.stats)
      }
    }
    return out
  }

  normalizeGameStatus(raw: string | null | undefined): LiveGameStatus {
    return normalizeLiveGameStatus(raw ?? null)
  }
}

/** Team keys for the given games, in the shared `nfl:def:<TEAM>` convention. */
export function defenseKeysFor(games: readonly LiveGameLite[]): string[] {
  const out = new Set<string>()
  for (const g of games) {
    if (g.homeTeam) out.add(defKey(g.homeTeam))
    if (g.awayTeam) out.add(defKey(g.awayTeam))
  }
  return [...out]
}
