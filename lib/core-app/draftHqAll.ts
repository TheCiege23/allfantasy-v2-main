import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Draft Season HQ, across every league — the cross-league aggregator.
 *
 * ⚠ THIS EXISTS BECAUSE THE PER-LEAGUE LOADER CANNOT BACK A CROSS-LEAGUE MODULE.
 * `getDraftHqData(leagueId, userId)` answers for one league. Calling it in a loop
 * over 60 leagues is the exact N+1 fan-out that was removed from the signed-in
 * home — dozens of sequential round-trips per page load. This reads the same
 * tables in THREE set-based queries regardless of how many leagues the user has:
 *
 *   1. draftSession  WHERE leagueId IN (…)     — one row per league (leagueId is @unique)
 *   2. leagueTeam    WHERE leagueId IN (…) AND claimedByUserId = user
 *   3. draftPick     groupBy sessionId          — pick counts, one pass
 *
 * ⚠ THE STATUS VOCABULARY IS NOT ONE VOCABULARY. Grepping the draft code turns up
 * `pre_draft`, `scheduled`, `in_progress`, `paused`, `active`, `drafting`, `live`,
 * `running`, `on_clock`, `post_draft`, `complete`, `completed`, `expired` and
 * `none` — some ours, some a provider's, and both `complete` AND `completed` are
 * real. So the mapping below is deliberately generous, and anything it does not
 * recognise is reported as `unknown` WITH its raw value rather than being
 * bucketed into a guess. A draft silently filed as "upcoming" when it is actually
 * finished is worse than one labelled with a status the reader can look up.
 */

export type DraftPhase = 'live' | 'upcoming' | 'done' | 'unknown'

export type DraftHqAllRow = {
  leagueId: string
  leagueName: string
  platform: string | null
  /** Platform league avatar, so a draft card is recognisable at a glance. */
  imageUrl: string | null
  /** Normalised bucket for grouping and ordering. */
  phase: DraftPhase
  /** The value straight from the row — shown when `phase` is 'unknown'. */
  rawStatus: string
  draftType: string | null
  rounds: number | null
  teamCount: number | null
  /** Your slot in the order, when your team is in it. */
  yourSlot: number | null
  /** Picks recorded for this draft. Null when none are stored. */
  picksMade: number | null
  /** When status is in_progress, when the current pick expires. */
  pickExpiresAt: string | null
}

export type DraftHqAllData = {
  rows: DraftHqAllRow[]
  counts: { live: number; upcoming: number; done: number; unknown: number }
  /** Leagues with no draftSession row at all — not an error, just not set up. */
  withoutDraft: number
}

const LIVE = new Set(['in_progress', 'paused', 'active', 'drafting', 'live', 'running', 'on_clock'])
const UPCOMING = new Set(['pre_draft', 'scheduled'])
const DONE = new Set(['complete', 'completed', 'post_draft', 'expired'])

export function phaseOf(status: string | null | undefined): DraftPhase {
  const s = (status ?? '').trim().toLowerCase()
  if (!s || s === 'none') return 'unknown'
  if (LIVE.has(s)) return 'live'
  if (UPCOMING.has(s)) return 'upcoming'
  if (DONE.has(s)) return 'done'
  return 'unknown'
}

/** Live first, then upcoming, then unknown, then done. Within a phase, by name. */
const PHASE_RANK: Record<DraftPhase, number> = { live: 0, upcoming: 1, unknown: 2, done: 3 }

export async function getDraftHqAll(
  userId: string,
  leagues: Array<{
    id: string
    name?: string | null
    platform?: string | null
    imageUrl?: string | null
  }>,
): Promise<DraftHqAllData> {
  const empty: DraftHqAllData = {
    rows: [],
    counts: { live: 0, upcoming: 0, done: 0, unknown: 0 },
    withoutDraft: 0,
  }
  if (leagues.length === 0) return empty

  const leagueIds = leagues.map((l) => l.id)

  const [sessions, myTeams] = await Promise.all([
    prisma.draftSession.findMany({
      where: { leagueId: { in: leagueIds } },
      select: {
        id: true,
        leagueId: true,
        status: true,
        draftType: true,
        rounds: true,
        teamCount: true,
        slotOrder: true,
        timerEndAt: true,
      },
    }),
    prisma.leagueTeam.findMany({
      where: { leagueId: { in: leagueIds }, claimedByUserId: userId },
      select: { leagueId: true, externalId: true },
    }),
  ])

  if (sessions.length === 0) {
    return { ...empty, withoutDraft: leagues.length }
  }

  // One pass for pick counts rather than a query per draft.
  const pickCounts = await prisma.draftPick
    .groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: sessions.map((s) => s.id) } },
      _count: { _all: true },
    })
    .catch(() => [] as Array<{ sessionId: string; _count: { _all: number } }>)

  const picksBySession = new Map(pickCounts.map((p) => [p.sessionId, p._count._all]))
  const teamByLeague = new Map(myTeams.map((t) => [t.leagueId, t.externalId]))
  const metaById = new Map(leagues.map((l) => [l.id, l]))

  const rows: DraftHqAllRow[] = sessions.map((session) => {
    const meta = metaById.get(session.leagueId)
    const phase = phaseOf(session.status)

    /*
     * Same slot resolution as the per-league loader, deliberately — the two must
     * not disagree about which pick is yours. slotOrder is untyped JSON, so it is
     * narrowed rather than trusted.
     */
    const order = Array.isArray(session.slotOrder)
      ? (session.slotOrder as Array<{ slot?: number; rosterId?: string }>)
      : []
    const externalId = teamByLeague.get(session.leagueId)
    const entry = externalId
      ? order.find((o) => String(o.rosterId) === String(externalId))
      : undefined

    return {
      leagueId: session.leagueId,
      leagueName: meta?.name?.trim() || 'League',
      platform: meta?.platform ?? null,
      imageUrl: meta?.imageUrl ?? null,
      phase,
      rawStatus: session.status,
      draftType: session.draftType ?? null,
      rounds: session.rounds ?? null,
      teamCount: session.teamCount ?? null,
      yourSlot: typeof entry?.slot === 'number' ? entry.slot : null,
      picksMade: picksBySession.get(session.id) ?? null,
      // Only meaningful while a pick is actually running.
      pickExpiresAt:
        phase === 'live' && session.timerEndAt ? session.timerEndAt.toISOString() : null,
    }
  })

  rows.sort(
    (a, b) => PHASE_RANK[a.phase] - PHASE_RANK[b.phase] || a.leagueName.localeCompare(b.leagueName),
  )

  const counts = { live: 0, upcoming: 0, done: 0, unknown: 0 }
  for (const row of rows) counts[row.phase] += 1

  return { rows, counts, withoutDraft: leagues.length - sessions.length }
}
