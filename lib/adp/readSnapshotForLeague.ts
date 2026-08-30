/**
 * D.5-test â read `AllFantasyAdpSnapshot` rows for a given league context.
 *
 * Server-side only. Returns entries in the same shape the legacy
 * `getAiAdpForLeague` produces, so callers (the `/api/leagues/[leagueId]/ai-adp`
 * route, the resolver, future UI code) can opt into the new table without
 * changing their consumer logic.
 *
 * Important: NEVER falls back to external/market ADP. If no snapshot exists for
 * the requested (sport, leagueType, draftType, scoringFormat, rosterFormat,
 * teamCount, season, draftMode) tuple, returns an empty `entries` array. The
 * UI must render em-dashes â that's the explicit user rule for AI ADP.
 */

import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  buildContextHash,
  type DraftContext,
  type DraftMode,
} from './computeAllFantasyAdp'
import { buildDraftContext } from '@/lib/adp/draftContextKey'
import { loadAdpBoard } from '@/lib/adp/loadAdpBoard'

export interface AllFantasyAdpEntry {
  playerName: string
  position: string
  team: string | null
  /** Player key the resolver/table uses to join (`<lowercased name>|<lowercased position>`). */
  playerKey: string
  adp: number
  averageRound: number
  averagePickInRound: number
  minPick: number
  maxPick: number
  sampleSize: number
  /** Heuristic â flagged when sample size < 10 (UI shows a faint "low sample" pill). */
  lowSample: boolean
  sevenDayTrend: number | null
  thirtyDayTrend: number | null
  /** `exact` = measured at this league size. `cross_size` = projected from other sizes. */
  source?: 'exact' | 'cross_size'
  /** Cross-size only: which league sizes contributed. Null for exact rows. */
  contributingTeamCounts?: number[] | null
}

export interface AllFantasyAdpReadResult {
  entries: AllFantasyAdpEntry[]
  totalDrafts: number
  computedAt: Date | null
  contextHash: string
  draftMode: DraftMode
  /** Players measured at this exact league size. */
  exactCount?: number
  /** Players filled by projecting from other league sizes. */
  crossSizeCount?: number
}

const LOW_SAMPLE_THRESHOLD = 10

export async function readAllFantasyAdpForContext(
  context: DraftContext,
  options: { draftMode?: DraftMode } = {},
): Promise<AllFantasyAdpReadResult> {
  const draftMode = options.draftMode ?? 'real'

  /*
   * Delegates to loadAdpBoard, which adds the CROSS-SIZE tier on top of the exact one. Before
   * that tier existed, every league whose size had no board of its own read em-dashes - measured
   * on production, that was every 8-, 14-, 22- and 27-team league, while 25,261 of 27,742 rows
   * sat on imported boards no league could resolve to.
   *
   * The no-market-fallback rule in this file's header still holds and is not weakened: a
   * cross-size entry is OUR OWN draft data from a different league size, projected through
   * rounds. It is never external/market ADP wearing an AI ADP label.
   */
  const board = await loadAdpBoard(context, { draftMode })
  const contextHash = board.contextHash

  const entries: AllFantasyAdpEntry[] = board.entries.map((e) => {
    const [, posLower] = e.playerKey.split('|')
    return {
      playerName: e.playerName,
      position: (posLower ?? '').toUpperCase(),
      team: null,
      playerKey: e.playerKey,
      adp: e.adp,
      averageRound: e.averageRound ?? 0,
      averagePickInRound: e.averagePickInRound ?? 0,
      minPick: e.minPick ?? 0,
      maxPick: e.maxPick ?? 0,
      sampleSize: e.sampleSize,
      lowSample: e.sampleSize < LOW_SAMPLE_THRESHOLD,
      sevenDayTrend: e.sevenDayTrend,
      thirtyDayTrend: e.thirtyDayTrend,
      source: e.source,
      contributingTeamCounts: e.contributingTeamCounts,
    }
  })

  const totalDrafts = entries.reduce((max, e) => Math.max(max, e.sampleSize), 0)

  return {
    entries,
    totalDrafts,
    computedAt: board.computedAt,
    contextHash,
    draftMode,
    exactCount: board.exactCount,
    crossSizeCount: board.crossSizeCount,
  }
}

/**
 * Convenience: derive context from a League row + season override and read entries.
 * Used by API routes that have a leagueId in hand.
 */
export async function readAllFantasyAdpForLeague(
  leagueId: string,
  options: { draftMode?: DraftMode; season?: string } = {},
): Promise<AllFantasyAdpReadResult> {
  /*
   * ⚠ THE DRAFT SESSION IS SELECTED, AND IT IS NOT AN OPTIONAL DETAIL - IT IS THE FIX.
   * This function used to derive `draftType` from `settings.draft.type` and `teamCount` from
   * `League.leagueSize`, while the recompute wrote them from `DraftSession.draftType` and
   * `DraftSession.teamCount`. Any disagreement changed the sha256 context hash, so the read
   * returned zero rows for players written moments earlier - and because this module never falls
   * back to market ADP by design, the UI rendered em-dashes, which is EXACTLY what it renders when
   * we legitimately have no samples. The bug and the correct behaviour looked identical.
   *
   * DraftSession.leagueId is unique, so this relation is at most one row.
   */
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      sport: true,
      season: true,
      scoring: true,
      isDynasty: true,
      leagueVariant: true,
      leagueSize: true,
      settings: true,
      draftSessions: { select: { draftType: true, teamCount: true } },
    },
  })
  if (!league) {
    return {
      entries: [],
      totalDrafts: 0,
      computedAt: null,
      contextHash: '',
      draftMode: options.draftMode ?? 'real',
    }
  }

  const context: DraftContext = buildDraftContext({
    league: {
      sport: String(league.sport ?? 'NFL'),
      season: Number(league.season ?? new Date().getUTCFullYear()),
      scoring: league.scoring,
      isDynasty: league.isDynasty,
      leagueVariant: league.leagueVariant,
      leagueSize: league.leagueSize,
      settings: league.settings,
    },
    session: league.draftSessions ?? null,
    season: options.season ?? null,
  })
  return readAllFantasyAdpForContext(context, options)
}
