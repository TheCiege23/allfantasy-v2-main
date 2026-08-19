/**
 * Player Command Center (Slice 4) — per-league waiver world state.
 *
 * Answers "can I add a replacement RIGHT NOW, or do I have to wait for a
 * waiver run?" deterministically from REAL models only:
 *   - LeagueWaiverSettings (waiverType, faabBudget, instantFaAfterClear)
 *   - LeagueWaiverState    (lastRunAt, nextRunAt, processingLocked)
 *   - Roster               (faabRemaining, waiverPriority — passed in by the
 *                           caller, which already loaded the user's rosters)
 *   - WaiverClaim          (the user's own pending claims)
 * Anything the schema can't answer stays null — never inferred. All queries
 * are best-effort: a failure yields an absent entry, never a thrown error.
 */
import { prisma } from '@/lib/prisma'

export type WaiverClaimMode = 'faab' | 'priority' | 'first_come' | 'unknown'

export interface LeagueWaiverWorldState {
  leagueId: string
  /** Raw configured waiver type (e.g. "faab", "standard"), null when unconfigured. */
  waiverType: string | null
  claimMode: WaiverClaimMode
  faabBudget: number | null
  userFaabRemaining: number | null
  userWaiverPriority: number | null
  /** Free agents addable immediately once they clear waivers (real setting). */
  instantFaAfterClear: boolean | null
  lastRunAt: string | null
  nextRunAt: string | null
  processingLocked: boolean | null
  /** True when a run completed within the last 24h of `now` — "waivers already ran". Null when lastRunAt is unknown. */
  ranWithinLastDay: boolean | null
  /** The user's own pending claims in this league. */
  userPendingClaimCount: number
}

export interface UserRosterWaiverInfo {
  rosterId: string
  faabRemaining: number | null
  waiverPriority: number | null
}

/** Exported for unit tests — deterministic waiverType → claim-mode mapping. */
export function toClaimMode(waiverType: string | null): WaiverClaimMode {
  const t = (waiverType ?? '').toLowerCase()
  if (!t) return 'unknown'
  if (t.includes('faab') || t.includes('bid')) return 'faab'
  if (t.includes('first') || t.includes('fcfs') || t.includes('free')) return 'first_come'
  if (t.includes('standard') || t.includes('priority') || t.includes('rolling') || t.includes('reverse')) return 'priority'
  return 'unknown'
}

export async function resolveLeagueWaiverWorldStates(args: {
  leagueIds: string[]
  /** The user's roster per league (already membership-resolved by the caller). */
  userRosterByLeague: Map<string, UserRosterWaiverInfo>
  now: Date
}): Promise<Map<string, LeagueWaiverWorldState>> {
  const { leagueIds, userRosterByLeague, now } = args
  if (leagueIds.length === 0) return new Map()

  const [settingsRows, stateRows, pendingClaims] = await Promise.all([
    prisma.leagueWaiverSettings
      .findMany({
        where: { leagueId: { in: leagueIds } },
        select: { leagueId: true, waiverType: true, faabBudget: true, instantFaAfterClear: true },
      })
      .catch(() => []),
    prisma.leagueWaiverState
      .findMany({
        where: { leagueId: { in: leagueIds } },
        select: { leagueId: true, lastRunAt: true, nextRunAt: true, processingLocked: true },
      })
      .catch(() => []),
    (() => {
      const rosterIds = Array.from(userRosterByLeague.values()).map((r) => r.rosterId)
      if (rosterIds.length === 0) return Promise.resolve([] as Array<{ leagueId: string }>)
      return prisma.waiverClaim
        .findMany({
          where: { rosterId: { in: rosterIds }, status: 'pending' },
          select: { leagueId: true },
        })
        .catch(() => [] as Array<{ leagueId: string }>)
    })(),
  ])

  const settingsByLeague = new Map(settingsRows.map((s) => [s.leagueId, s]))
  const stateByLeague = new Map(stateRows.map((s) => [s.leagueId, s]))
  const pendingByLeague = new Map<string, number>()
  for (const claim of pendingClaims) {
    pendingByLeague.set(claim.leagueId, (pendingByLeague.get(claim.leagueId) ?? 0) + 1)
  }

  const out = new Map<string, LeagueWaiverWorldState>()
  for (const leagueId of leagueIds) {
    const settings = settingsByLeague.get(leagueId)
    const state = stateByLeague.get(leagueId)
    const roster = userRosterByLeague.get(leagueId)
    const lastRunAt = state?.lastRunAt ?? null
    out.set(leagueId, {
      leagueId,
      waiverType: settings?.waiverType ?? null,
      claimMode: toClaimMode(settings?.waiverType ?? null),
      faabBudget: settings?.faabBudget ?? null,
      userFaabRemaining: roster?.faabRemaining ?? null,
      userWaiverPriority: roster?.waiverPriority ?? null,
      instantFaAfterClear: settings ? settings.instantFaAfterClear : null,
      lastRunAt: lastRunAt ? lastRunAt.toISOString() : null,
      nextRunAt: state?.nextRunAt ? state.nextRunAt.toISOString() : null,
      processingLocked: state ? state.processingLocked : null,
      ranWithinLastDay: lastRunAt ? now.getTime() - lastRunAt.getTime() <= 24 * 60 * 60_000 : null,
      userPendingClaimCount: pendingByLeague.get(leagueId) ?? 0,
    })
  }
  return out
}
