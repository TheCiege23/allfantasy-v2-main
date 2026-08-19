/**
 * Put the Sleeper draft id back on draft sessions.
 *
 * THE IMPORT KEPT THE DRAFT'S SETTINGS AND DROPPED THE POINTER TO THE DRAFT. A league's
 * settings carry twelve draft-related keys — draft_type, draft_rounds,
 * draft_timer_seconds, draft_snake_or_linear, draft_third_round_reversal and so on — and
 * not `draft_id`. Measured on production: 0 of 55 Sleeper leagues carried one, including
 * 0 of the 18 currently drafting or pre-draft.
 *
 * Everything downstream depends on it. `getDraftIdFromSettings` returns null, so the
 * resolver at app/league/[leagueId]/draft never writes `DraftSession.sleeperDraftId`, so
 * `mirrorActiveSleeperDrafts` finds nothing to mirror and correctly reports zero. The
 * mirror and the resolver are both fine; they are downstream of a missing field.
 *
 * Sleeper hands `draft_id` back on the league object itself — `fetchSleeperLeagueDraftChain`
 * already reads exactly that. This asks for it directly rather than walking the chain,
 * because the chain also fetches every prior season's draft: up to 20 calls per league
 * where one will do, and across 55 leagues that is the difference between 55 requests and
 * roughly a thousand.
 *
 * ⚠ THIS ONLY FILLS SESSIONS THAT ALREADY EXIST. It does not create them. 55 Sleeper
 * leagues have 7 draft sessions between them, and materialising 48 more is a real write
 * with its own consequences — it is reported as a count so the decision stays visible
 * rather than being made silently here.
 */
import { prisma } from '@/lib/prisma'

const SLEEPER_V1 = 'https://api.sleeper.app/v1'

export type BackfillDraftIdsResult = {
  sessionsMissingId: number
  resolved: number
  /** The league genuinely has no draft on Sleeper yet — not an error. */
  noDraftUpstream: number
  failed: number
  /** Sleeper leagues with no DraftSession at all. Nothing here can fix those. */
  leaguesWithoutSession: number
  failures: Array<{ leagueId: string; reason: string }>
}

/**
 * The current draft id for a Sleeper league, or null when no draft exists yet.
 *
 * Exported so the league draft resolver can heal a single league on view rather than
 * waiting for a batch — the import never stored this, so a league that nobody backfilled
 * would otherwise open an empty board forever.
 *
 * Throws on a real upstream failure. A league with no draft yet returns null, which is a
 * normal state and not an error.
 */
export async function fetchDraftIdForLeague(platformLeagueId: string): Promise<string | null> {
  const res = await fetch(`${SLEEPER_V1}/league/${encodeURIComponent(platformLeagueId)}`, {
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`league fetch failed: ${res.status}`)
  const league = (await res.json()) as Record<string, unknown>
  const raw = league.draft_id
  if (raw == null) return null
  const id = String(raw).trim()
  return id.length > 0 ? id : null
}

export async function backfillSleeperDraftIds(
  opts: { maxLeagues?: number; leagueIds?: string[] } = {},
): Promise<BackfillDraftIdsResult> {
  const take = Math.min(Math.max(opts.maxLeagues ?? 100, 1), 500)

  const sessions = await prisma.draftSession.findMany({
    where: {
      sleeperDraftId: null,
      // platformLeagueId is non-nullable on League, so there is nothing to filter for —
      // an empty string is the only degenerate case and it is handled per row below.
      league: {
        platform: 'sleeper',
        ...(opts.leagueIds?.length ? { id: { in: opts.leagueIds } } : {}),
      },
    },
    select: { id: true, leagueId: true, league: { select: { platformLeagueId: true } } },
    take,
  })

  // Reported, not fixed: a league with no session cannot be given a draft id.
  const sleeperLeagues = await prisma.league.count({ where: { platform: 'sleeper' } })
  const sessionsForSleeper = await prisma.draftSession.count({
    where: { league: { platform: 'sleeper' } },
  })

  const result: BackfillDraftIdsResult = {
    sessionsMissingId: sessions.length,
    resolved: 0,
    noDraftUpstream: 0,
    failed: 0,
    leaguesWithoutSession: Math.max(0, sleeperLeagues - sessionsForSleeper),
    failures: [],
  }

  for (const s of sessions) {
    const platformLeagueId = s.league?.platformLeagueId?.trim()
    if (!platformLeagueId) {
      result.failed += 1
      result.failures.push({ leagueId: s.leagueId, reason: 'no platformLeagueId' })
      continue
    }
    try {
      const draftId = await fetchDraftIdForLeague(platformLeagueId)
      if (!draftId) {
        // A league in pre-draft with no draft created yet. Nothing to record.
        result.noDraftUpstream += 1
        continue
      }
      await prisma.draftSession.update({
        where: { id: s.id },
        data: { sleeperDraftId: draftId },
      })
      result.resolved += 1
    } catch (e) {
      // One league's outage must not stop the rest.
      result.failed += 1
      result.failures.push({
        leagueId: s.leagueId,
        reason: e instanceof Error ? e.message.slice(0, 120) : 'lookup failed',
      })
    }
  }

  return result
}
