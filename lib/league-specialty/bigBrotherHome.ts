/**
 * Big Brother league home — presentation-only extras for the specialty home
 * (design-refs/native-league-handoff/specialty-leagues/bigbrother/).
 *
 *   phaseStep       which of the six tracker steps the cycle's phase sits in
 *   nextDecision    the countdown: the current phase's scheduled deadline (lib/big-brother/schedule)
 *   lastEviction    the signature moment: result + per-nominee COUNT of the latest eviction
 *   feed            HOH / Veto / eviction events read from past cycles
 *
 * 🛑 SEALED BALLOTS (PRD §5.5): nothing here ever carries a voter id. The eviction result is read
 * from the engine's own `eviction` audit row, whose `voteCount` is already keyed by TARGET only,
 * and `publicEvictionResult` copies an allow-list of fields out of it — counts only when the league
 * set `publicVoteTotalsVisibility = 'exact'` (the same switch the chat announcement honours).
 */
import { prisma } from '@/lib/prisma'
import { BB_DEADLINES, resolveBigBrotherDeadlines, type DeadlineConfig } from '@/lib/big-brother/schedule'

const STEP_BY_PHASE: Record<string, number> = {
  HOH_OPEN: 0,
  HOH_LOCKED: 0,
  NOMINATION_OPEN: 1,
  NOMINATION_LOCKED: 1,
  VETO_DRAW: 2,
  VETO_CHALLENGE_OPEN: 2,
  VETO_DECISION_OPEN: 3,
  REPLACEMENT_NOMINATION_OPEN: 3,
  VOTING_OPEN: 4,
  VOTING_LOCKED: 5,
  EVICTION_RESOLVED: 5,
  JURY_UPDATE: 5,
  RESET_NEXT_WEEK: 5,
}

/** Tracker step (0–5: HOH, Nominations, Veto comp, Veto meeting, Eviction vote, Live eviction); -1 when unknown/no cycle. */
export function bbPhaseStep(phase: string | null | undefined): number {
  return phase && phase in STEP_BY_PHASE ? STEP_BY_PHASE[phase] : -1
}

export interface BigBrotherNextDecision {
  label: string
  at: string
}

/**
 * The next scheduled decision point at or after `now`: the current phase's own deadline first
 * (during voting that is "Voting closes / eviction"), else the next scheduled milestone this week.
 */
export function nextBigBrotherDecision(
  config: DeadlineConfig,
  cycle: { createdAt: Date | string; voteDeadlineAt?: Date | string | null; voteOpenedAt?: Date | string | null; phase: string },
  now: Date = new Date(),
): BigBrotherNextDecision | null {
  const dates = resolveBigBrotherDeadlines(config, cycle)
  const own = [...BB_DEADLINES].reverse().find((e) => e.phase === cycle.phase && e.action)
  if (own) {
    const at = dates[own.key]
    if (at && at > now) return { label: own.label, at: at.toISOString() }
  }
  for (const e of BB_DEADLINES) {
    const at = dates[e.key]
    if (at && at > now) return { label: e.label, at: at.toISOString() }
  }
  return null
}

export interface BigBrotherPublicEviction {
  week: number
  evictedRosterId: string
  /** The final nominees, evicted first. */
  nomineeRosterIds: string[]
  /** Votes to evict per nominee — present only when the league shows exact totals. */
  votesByNominee: Record<string, number> | null
  tied: boolean
  /** Who put them on the block (the week's HOH), when known. */
  nominatedByRosterId: string | null
  juryEnrolled: boolean
  releasedPlayerCount: number | null
}

/**
 * Allow-list copy of an `eviction` audit row. Anything else on the row — and every voter id —
 * is dropped by construction, because nothing is spread.
 */
export function publicEvictionResult(
  metadata: unknown,
  visibility: 'exact' | 'evicted_only' | string | null | undefined,
  extra: { nomineeRosterIds?: (string | null | undefined)[]; nominatedByRosterId?: string | null } = {},
): BigBrotherPublicEviction | null {
  if (!metadata || typeof metadata !== 'object') return null
  const m = metadata as Record<string, unknown>
  const evicted = typeof m.evictedRosterId === 'string' ? m.evictedRosterId : null
  const week = typeof m.week === 'number' ? m.week : null
  if (!evicted || week == null) return null
  const rawCounts = m.voteCount && typeof m.voteCount === 'object' ? (m.voteCount as Record<string, unknown>) : {}
  const nominees = [
    evicted,
    ...[...(extra.nomineeRosterIds ?? []), ...Object.keys(rawCounts)].filter(
      (id): id is string => typeof id === 'string' && id.length > 0 && id !== evicted,
    ),
  ].filter((id, i, a) => a.indexOf(id) === i)
  let votesByNominee: Record<string, number> | null = null
  if (visibility === 'exact') {
    votesByNominee = {}
    for (const id of nominees) {
      const v = rawCounts[id]
      votesByNominee[id] = typeof v === 'number' && Number.isFinite(v) ? v : 0
    }
  }
  return {
    week,
    evictedRosterId: evicted,
    nomineeRosterIds: nominees,
    votesByNominee,
    tied: m.tied === true,
    nominatedByRosterId: extra.nominatedByRosterId ?? null,
    juryEnrolled: m.juryEnrolled === true,
    releasedPlayerCount: typeof m.releasedPlayerCount === 'number' ? m.releasedPlayerCount : null,
  }
}

export type BigBrotherFeedEvent = { id: string; kind: 'hoh' | 'veto' | 'evict'; week: number; rosterId: string }

/** Feed from cycle rows, newest first: evicted (closed weeks), veto winner, HOH. */
export function bigBrotherFeed(
  cycles: { week: number; hohRosterId: string | null; vetoWinnerRosterId: string | null; evictedRosterId: string | null }[],
  limit = 4,
): BigBrotherFeedEvent[] {
  const out: BigBrotherFeedEvent[] = []
  for (const c of [...cycles].sort((a, b) => b.week - a.week)) {
    if (c.evictedRosterId) out.push({ id: `evict-${c.week}`, kind: 'evict', week: c.week, rosterId: c.evictedRosterId })
    if (c.vetoWinnerRosterId) out.push({ id: `veto-${c.week}`, kind: 'veto', week: c.week, rosterId: c.vetoWinnerRosterId })
    if (c.hohRosterId) out.push({ id: `hoh-${c.week}`, kind: 'hoh', week: c.week, rosterId: c.hohRosterId })
  }
  return out.slice(0, limit)
}

export interface BigBrotherHomeExtras {
  leagueName: string | null
  season: number | null
  phaseStep: number
  nextDecision: BigBrotherNextDecision | null
  lastEviction: BigBrotherPublicEviction | null
  feed: BigBrotherFeedEvent[]
}

export async function buildBigBrotherHomeExtras(args: {
  leagueId: string
  configId: string
  config: DeadlineConfig & { publicVoteTotalsVisibility?: string | null }
  current: { createdAt: Date; voteDeadlineAt: Date | null; voteOpenedAt: Date | null; phase: string } | null
  now?: Date
}): Promise<BigBrotherHomeExtras> {
  const { leagueId, configId, config, current } = args
  const [league, cycles, evictionRow] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { season: true, name: true } }).catch(() => null),
    prisma.bigBrotherCycle.findMany({
      where: { leagueId, configId },
      orderBy: { week: 'desc' },
      take: 6,
      select: {
        week: true,
        hohRosterId: true,
        vetoWinnerRosterId: true,
        evictedRosterId: true,
        nominee1RosterId: true,
        nominee2RosterId: true,
        replacementNomineeRosterId: true,
        vetoSavedRosterId: true,
      },
    }),
    prisma.bigBrotherAuditLog.findFirst({
      where: { leagueId, configId, eventType: 'eviction' },
      orderBy: { createdAt: 'desc' },
      select: { metadata: true },
    }),
  ])

  let lastEviction: BigBrotherPublicEviction | null = null
  if (evictionRow) {
    const week = (evictionRow.metadata as { week?: unknown } | null)?.week
    const cyc = cycles.find((c) => c.week === week)
    const finals = cyc
      ? [cyc.nominee1RosterId, cyc.nominee2RosterId, cyc.replacementNomineeRosterId].filter(
          (id) => id && id !== cyc.vetoSavedRosterId,
        )
      : []
    lastEviction = publicEvictionResult(evictionRow.metadata, config.publicVoteTotalsVisibility, {
      nomineeRosterIds: finals,
      nominatedByRosterId: cyc?.hohRosterId ?? null,
    })
  }

  return {
    leagueName: typeof league?.name === 'string' && league.name.trim() ? league.name.trim() : null,
    season: typeof league?.season === 'number' ? league.season : null,
    phaseStep: bbPhaseStep(current?.phase),
    nextDecision: current ? nextBigBrotherDecision(config, current, args.now) : null,
    lastEviction,
    feed: bigBrotherFeed(cycles),
  }
}
