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
}

export interface AllFantasyAdpReadResult {
  entries: AllFantasyAdpEntry[]
  totalDrafts: number
  computedAt: Date | null
  contextHash: string
  draftMode: DraftMode
}

const LOW_SAMPLE_THRESHOLD = 10

export async function readAllFantasyAdpForContext(
  context: DraftContext,
  options: { draftMode?: DraftMode } = {},
): Promise<AllFantasyAdpReadResult> {
  const draftMode = options.draftMode ?? 'real'
  const contextHash = buildContextHash(context)

  const rows = await prisma.allFantasyAdpSnapshot.findMany({
    where: { contextHash, draftMode },
    orderBy: { averageOverallPick: 'asc' },
    select: {
      playerKey: true,
      playerName: true,
      sampleSize: true,
      averageOverallPick: true,
      averageRound: true,
      averagePickInRound: true,
      minOverallPick: true,
      maxOverallPick: true,
      sevenDayTrend: true,
      thirtyDayTrend: true,
      lastUpdatedAt: true,
    },
  })

  const entries: AllFantasyAdpEntry[] = rows.map((r) => {
    // playerKey is `<name>|<position>` â split for the consumer shape.
    const [, posLower] = r.playerKey.split('|')
    return {
      playerName: r.playerName,
      position: (posLower ?? '').toUpperCase(),
      team: null, // team isn't stored in the snapshot â UI joins to pool by playerKey.
      playerKey: r.playerKey,
      adp: r.averageOverallPick,
      averageRound: r.averageRound,
      averagePickInRound: r.averagePickInRound,
      minPick: r.minOverallPick,
      maxPick: r.maxOverallPick,
      sampleSize: r.sampleSize,
      lowSample: r.sampleSize < LOW_SAMPLE_THRESHOLD,
      sevenDayTrend: r.sevenDayTrend,
      thirtyDayTrend: r.thirtyDayTrend,
    }
  })

  // totalDrafts â derive from max sampleSize across entries (rough but useful for UI).
  // The recompute script could store it separately later; for the test harness
  // this is sufficient to surface "N drafts" in tooltips.
  const totalDrafts = entries.reduce((max, e) => Math.max(max, e.sampleSize), 0)

  // computedAt â most recent lastUpdatedAt across the snapshot set.
  let computedAt: Date | null = null
  for (const r of rows) {
    if (!computedAt || r.lastUpdatedAt > computedAt) computedAt = r.lastUpdatedAt
  }

  return { entries, totalDrafts, computedAt, contextHash, draftMode }
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
