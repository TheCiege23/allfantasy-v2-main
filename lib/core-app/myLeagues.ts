import 'server-only'

import { getDashboardLeagueListForUser } from '@/lib/dashboard/get-dashboard-league-list'
import { getDash34Data, type Dash34LeagueRow } from './dash34'
import type { Dash34League } from '@/components/core-app/screens/Dashboard34'

/**
 * The loader behind 21a — "My Leagues, at 61 live".
 *
 * ⚠ THIS DELIBERATELY RE-USES THE 34a CHAIN RATHER THAN RE-DERIVING URGENCY.
 * `getDash34Data` already answers "what needs you", it was built against a
 * production census, and its `allLeagues` is the uncapped, urgency-ranked list
 * this screen wants. A second ranking written here would be a second opinion
 * about the same rows, and the two would drift the first time either changed.
 * One ranking, two surfaces — the same argument the loader itself makes for
 * `leagues` (capped queue) versus `allLeagues` (browsable list).
 *
 * ⚠ WHAT THE HANDOFF DRAWS THAT THIS CANNOT SHOW, AND WHY. 21a's cards carry a
 * live score vs opponent, a win probability, and a record + rank on every quiet
 * tile. None of those has an operand on this database:
 *
 *   - `LeagueTeam` rows with ANY result (W/L/T/PF/PA): **0 of 893**, re-counted
 *     after 54 Sleeper syncs landed. So there is no record, no rank worth
 *     printing and no score.
 *   - `WeeklyMatchup`: 262 rows, all season 2025, and **0 of their league ids
 *     join `leagues.id`** — they are platform ids, the other id space. There is
 *     no current-season scored matchup for anybody.
 *   - There is no win-probability model behind a league list; `/my-team`'s
 *     figure is a points ratio, and it is labelled as one there.
 *
 * `LeagueTeam.currentRank` IS non-null on ~798 rows and is deliberately NOT read
 * here: it is an ordering written over rows whose wins, losses and points are
 * all zero, so it ranks nothing. Printing it would be the "a C grade means zero
 * data" failure with a number instead of a letter.
 *
 * The three tiers are therefore keyed on the signals that ARE real — an
 * unavailable starter, a draft in progress, a flagged player, being the person
 * accountable for the league — and `coverage` carries the withheld list through
 * to the screen so the page says what it is not showing instead of implying it
 * has nothing to say.
 *
 * ⚠ "LIVE" vs "HISTORY" IS `hasUnifiedRecord`, NOT A NEW FLAG. The handoff's
 * Live / "+ history" toggle and its "543 past seasons" footer are the same split
 * the 34a rail already makes: `hasUnifiedRecord === false` marks an AF Legacy
 * board row — a career-import season snapshot, not a league you play. That is
 * where the design's 604-vs-61 gap comes from, and reading it any other way is
 * what produced the original 604-row flood.
 *
 * Nothing here calls a provider. Every read is Postgres.
 */

/** One finished season from the AF Legacy career import — searchable, never a "league you play". */
export type MyLeaguesHistoryRow = {
  id: string
  name: string
  platform: string
  season: string | null
}

export type MyLeaguesTier = 'needs' | 'playing' | 'quiet'

export type MyLeaguesLeague = Dash34League & {
  tier: MyLeaguesTier
  /** Real `League.isDynasty` — drives the Dynasty chip, which the handoff counts. */
  isDynasty: boolean
  isCommissioner: boolean
  /** The single most specific blocking cause, already phrased by the 34a chip builder. */
  reason: string | null
}

export type MyLeaguesData = {
  leagues: MyLeaguesLeague[]
  history: MyLeaguesHistoryRow[]
  counts: {
    live: number
    history: number
    /** live + history — the "search across 604 leagues" number. */
    all: number
    needs: number
    playing: number
    quiet: number
    commissioner: number
    drafting: number
    dynasty: number
  }
  /** Distinct platforms present, for the platform filter. Never a hardcoded list. */
  platforms: string[]
  /** What this screen is NOT showing, and why — passed straight through from 34a. */
  coverage: Array<{ label: string; reason: string }>
  /** Set when no league has ever been synced; the same notice 34a raises. */
  notice: { title: string; body: string; href?: string | null; label?: string | null } | null
}

type RawRow = Dash34LeagueRow & { season?: number | string | null }

function seasonOf(row: RawRow): string | null {
  const s = row.season
  if (s == null || s === '') return null
  return String(s)
}

/**
 * The tier a league belongs to.
 *
 * ⚠ THE HANDOFF'S MIDDLE TIER IS "PLAYING NOW" AND IT IS NOT A LIVE-SCORE TIER
 * HERE, BECAUSE THERE ARE NO LIVE SCORES. What survives of that idea is
 * "in season, roster on file, nothing blocking" — a real state, distinct from
 * both "needs you" and "quiet", and the tier header says which of the two claims
 * it is making. Folding it into "quiet" would have been the easier lie: it would
 * report 50 leagues as needing nothing when half of them are mid-season.
 */
function tierOf(l: Dash34League): MyLeaguesTier {
  const chips = l.chips ?? []
  const has = (label: string) => chips.some((c) => c.label === label)

  // Anything the 34a ranker treats as a call to action.
  if (l.priority === 'urgent' || l.priority === 'draft') return 'needs'
  if (chips.some((c) => c.tone === 'bad' || c.tone === 'warn')) return 'needs'

  // In season with a roster read, nothing blocking.
  if (has('SEASON OVER')) return 'quiet'
  if (l.matchupNote === 'No roster imported yet') return 'quiet'
  return 'playing'
}

/**
 * The specific cause, never a generic "action needed" — the handoff's copy
 * contract. This is the first chip the 34a builder pushed that carries a bad or
 * warn tone, which is by construction the most specific thing known about the
 * league ("2 STARTERS OUT", "PRE DRAFT"), not a category name.
 */
function reasonOf(l: Dash34League): string | null {
  const chips = l.chips ?? []
  const flagged = chips.find((c) => c.tone === 'bad') ?? chips.find((c) => c.tone === 'warn')
  if (flagged) return flagged.label
  if (chips.some((c) => c.label === 'DRAFTING')) return 'DRAFTING'
  return null
}

export async function getMyLeaguesData(userId: string, now: Date = new Date()): Promise<MyLeaguesData> {
  const payload = await getDashboardLeagueListForUser(userId)
  const rows = (payload?.leagues ?? []) as unknown as RawRow[]

  /*
   * ⚠ `hasUnifiedRecord !== false`, NOT `=== true`. The field is optional on
   * native rows, where `undefined` means "this is a real league" rather than
   * "unknown". `=== true` would drop every AllFantasy-native league from the
   * screen, which is the inverse of the bug this filter exists to fix.
   */
  const played = rows.filter((r) => r.hasUnifiedRecord !== false)
  const legacy = rows.filter((r) => r.hasUnifiedRecord === false)

  const dash = await getDash34Data(userId, played as Dash34LeagueRow[], now).catch(() => null)

  const rowById = new Map<string, RawRow>()
  for (const r of played) rowById.set(r.id, r)

  /*
   * `allLeagues` is the uncapped ranked list; `leagues` is the 8-row queue. Using
   * the queue here would silently show 8 of 61.
   */
  const ranked: Dash34League[] = dash?.allLeagues ?? []

  const leagues: MyLeaguesLeague[] = ranked.map((l) => {
    const row = rowById.get(l.id)
    return {
      ...l,
      tier: tierOf(l),
      isDynasty: Boolean(row?.isDynasty),
      isCommissioner: Boolean(row?.isCommissioner),
      reason: reasonOf(l),
    }
  })

  const history: MyLeaguesHistoryRow[] = legacy.map((r) => ({
    id: r.id,
    name: String(r.name ?? 'Untitled league'),
    platform: String(r.platform ?? 'allfantasy').toLowerCase(),
    season: seasonOf(r),
  }))

  const platforms = Array.from(new Set(leagues.map((l) => String(l.platform).toLowerCase()))).sort()

  const counts = {
    live: leagues.length,
    history: history.length,
    all: leagues.length + history.length,
    needs: leagues.filter((l) => l.tier === 'needs').length,
    playing: leagues.filter((l) => l.tier === 'playing').length,
    quiet: leagues.filter((l) => l.tier === 'quiet').length,
    commissioner: leagues.filter((l) => l.isCommissioner).length,
    drafting: leagues.filter((l) => l.priority === 'draft' || (l.chips ?? []).some((c) => c.label === 'PRE DRAFT')).length,
    dynasty: leagues.filter((l) => l.isDynasty).length,
  }

  return {
    leagues,
    history,
    counts,
    platforms,
    coverage: dash?.coverage ?? [],
    notice: dash?.notice ?? null,
  }
}
