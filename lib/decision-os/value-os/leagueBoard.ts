import 'server-only'

import { createHash } from 'node:crypto'
import { createOsFeed, type OsFactSource } from '../domain-os/feed'
import type { OsStore } from '../domain-os/store'
import { MINUTES } from '../domain-os/types'
import { decodeFacts, encodeFacts, type EncodedFacts } from '../domain-os/factCodec'
import { decisionOsFlagReadsAsOff } from '../flags'
import {
  loadSportPointsBase,
  type SportPointsBaseResult,
  type SportPointsLeague,
} from '../trade/sportPointsContext'
import type { PointsGradedSport, SportPointsContext } from '../trade/sportPointsValue'

/**
 * A league's value board through the domain-OS kernel (2026-11-21, ranked build item 4) — NBA, NHL, MLB, college
 * basketball and soccer.
 *
 * 🛑 THE BOARD WAS BUILT FROM SCRATCH ON EVERY READ. One Chimmy value turn, a Waivers load, a player card and a trade
 * grade each ran `loadSportPointsBase` — the season's projections for the whole sport, the league's rosters, the
 * schedule, the completed-trade market and, in a dynasty league, every player's age — inside the packet's 2.4 s
 * deadline when Chimmy asked. Every surface reads the same league board now, built once and held three minutes.
 *
 * ⚠ ONE BOARD FOR THE TRADE GRADE AND EVERY VALUE SURFACE. `leagueValueBoard.ts` promises the value answer, the
 * Waivers board and the card read the board the trade grade prices. Caching the value surfaces alone would break
 * that for up to a TTL, so the in-league trade grader reads through here too (`sportPointsGrader.ts`).
 *
 * ⚠ THREE MINUTES: Trade OS's own roster TTL. The board's free-agent levels and roster index come from the league's
 * rosters, so a trade is never graded on rosters older than Trade OS already allows.
 *
 * ⚠ STORED THROUGH `factCodec`: the board holds Maps, a dynasty context of Maps, and non-finite rates, none of which
 * survive plain JSON. A refusal is never cached (it reaches the caller with its own reason); neither is a throw.
 *
 * ⚠ KEYED ON WHAT THE BUILDER READS, NOT ON THE LEAGUE ID ALONE. Callers hand the builder slightly different league
 * rows — the trade grader a normalized `leagueType`, the roster grade a row without its platform, a Guilly grade its
 * own league type — and each of those builds a different board. The scope is the league, the sport and a fingerprint
 * of every league field the builder reads, so identical inputs share one board and different inputs never overwrite
 * each other.
 *
 * Off switch, deploy-time, no database needed: `DECISION_OS_VALUE_BOARD_CACHE=off` builds live, exactly as before.
 */

export const VALUE_BOARD_CACHE_ENV = 'DECISION_OS_VALUE_BOARD_CACHE'

type BoardArgs = {
  sport: PointsGradedSport
  league: SportPointsLeague
  /**
   * Not part of the scope: what the kernel's null cannot carry back — a refusal (so its reason is not lost), or a
   * board that was built but has no faithful encoding (served, never stored, so it never reads as "unavailable").
   */
  refusal: { result?: Extract<SportPointsBaseResult, { ok: false }>; uncacheable?: SportPointsContext }
  build: typeof loadSportPointsBase
}

/** Keys sorted at every level, so two equal settings blobs always fingerprint alike. */
function stableJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const o = value as Record<string, unknown>
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`
}

/** Every league field `loadSportPointsBase` reads — the board is a function of these and the sport. */
export function leagueBoardFingerprint(league: SportPointsLeague): string {
  const { platform, platformLeagueId, settings, leagueType, leagueSize, season, status } = league
  return createHash('sha256')
    .update(stableJson({ platform, platformLeagueId, settings, leagueType, leagueSize, season, status }))
    .digest('hex')
    .slice(0, 16)
}

export const leagueValueBoardSource: OsFactSource<BoardArgs, EncodedFacts> = {
  kind: 'leagueBoard',
  level: 'league',
  ttlMs: 3 * MINUTES,
  scopeKey: (a) => `${a.league.id}:${a.sport}:${leagueBoardFingerprint(a.league)}`,
  sport: (a) => a.sport,
  derive: async (a) => {
    const built = await a.build({ sport: a.sport, league: a.league })
    if (!built.ok) {
      a.refusal.result = built
      return null
    }
    try {
      return encodeFacts(built.ctx)
    } catch {
      a.refusal.uncacheable = built.ctx
      return null
    }
  },
}

export type CachedBoardResult = SportPointsBaseResult & { servedFrom?: 'store' | 'live' }

export type LeagueBoardDeps = {
  store?: OsStore
  build?: typeof loadSportPointsBase
  env?: Record<string, string | undefined>
}

/**
 * `loadSportPointsBase` for a league, through the cache. Never throws. The open analyzer (no league, a chosen
 * format) and the campus-only NCAAB read are not league boards and keep calling the builder directly.
 */
export async function loadCachedLeagueBoardBase(
  args: { sport: PointsGradedSport; league: SportPointsLeague },
  deps: LeagueBoardDeps = {},
): Promise<CachedBoardResult> {
  const build = deps.build ?? loadSportPointsBase
  const env = deps.env ?? process.env
  const couldNot: CachedBoardResult = { ok: false, reason: `This league’s ${args.sport} values could not be loaded just now.` }
  if (decisionOsFlagReadsAsOff(env[VALUE_BOARD_CACHE_ENV])) {
    return build(args).catch(() => couldNot)
  }
  const scope = leagueValueBoardSource.scopeKey({ ...args, refusal: {}, build })
  let read = inFlight.get(scope)
  if (!read) {
    read = readThrough(args, build, deps.store).finally(() => inFlight.delete(scope))
    inFlight.set(scope, read)
  }
  const r = await read.catch(() => null)
  if (!r) return couldNot
  // Each caller decodes its own copy: concurrent readers never share one mutable board.
  if (r.facts != null) return { ok: true, ctx: decodeFacts<SportPointsContext>(r.facts), servedFrom: r.servedFrom }
  if (r.uncacheable) {
    // Built but not storable: served live. A copy where one can be made, so concurrent readers do not share it.
    let ctx = r.uncacheable
    try {
      ctx = structuredClone(r.uncacheable)
    } catch {
      /* the board itself — the only reader in the overwhelmingly common case */
    }
    return { ok: true, ctx, servedFrom: 'live' }
  }
  return r.refusal ?? couldNot
}

type Read = {
  facts: EncodedFacts | null
  servedFrom: 'store' | 'live'
  refusal?: Extract<SportPointsBaseResult, { ok: false }>
  uncacheable?: SportPointsContext
}

/**
 * Concurrent reads of one league's board in this process share one kernel read — the packet's value slice and its
 * league-metrics slice ask in the same first wave, and two misses would otherwise both build. Cleared when it settles.
 */
const inFlight = new Map<string, Promise<Read>>()

async function readThrough(
  args: { sport: PointsGradedSport; league: SportPointsLeague },
  build: typeof loadSportPointsBase,
  store: OsStore | undefined,
): Promise<Read> {
  const feed = createOsFeed('value', store ? { store } : {})
  const refusal: BoardArgs['refusal'] = {}
  const facts = await feed.get(leagueValueBoardSource, { ...args, refusal, build })
  const servedFrom = feed.drainOutcomes()[leagueValueBoardSource.kind]?.servedFrom === 'store' ? 'store' : 'live'
  return { facts, servedFrom, refusal: refusal.result, uncacheable: refusal.uncacheable }
}
