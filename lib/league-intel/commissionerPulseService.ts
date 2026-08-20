import 'server-only'

/**
 * commissionerPulseService — the shared inactivity engine behind the per-league
 * Commissioner Pulse card AND the dashboard's league-health leaderboard.
 * Counted signals only: empty starter slots, transaction drought, downward
 * scoring trend (H2H deep sync), orphan rosters. Flagged at ≥2 signals; every
 * flag lists its exact signals.
 */

import { getLeagueH2H } from '@/lib/league-history/sleeperH2HService'

const SLEEPER = 'https://api.sleeper.app/v1'
const MAX_WEEKS = 18
export const PULSE_STALE_DAYS = 21

async function j<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${SLEEPER}${path}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

type WireRoster = { roster_id: number; owner_id: string | null; starters?: string[] | null }
type WireUser = {
  user_id: string
  display_name: string
  avatar: string | null
  metadata?: { team_name?: string | null } | null
}
type WireTransaction = { status: string; created: number; roster_ids?: number[] | null }

export type PulseManager = {
  rosterId: number
  ownerId: string | null
  name: string
  teamName: string | null
  avatar: string | null
  emptyStarters: number
  daysSinceTx: number | null
  trend: 'up' | 'down' | 'flat' | null
  signals: string[]
  flagged: boolean
}

export type CommissionerPulse = {
  version: 1
  fetchedAt: string
  flaggedCount: number
  managers: PulseManager[]
  method: string
}

export async function computeCommissionerPulse(
  sleeperLeagueId: string,
): Promise<CommissionerPulse | null> {
  const weekFetches = Array.from({ length: MAX_WEEKS }, (_, i) =>
    j<WireTransaction[]>(`/league/${sleeperLeagueId}/transactions/${i + 1}`),
  )
  const [rosters, users, h2h, ...weeks] = await Promise.all([
    j<WireRoster[]>(`/league/${sleeperLeagueId}/rosters`),
    j<WireUser[]>(`/league/${sleeperLeagueId}/users`),
    getLeagueH2H(sleeperLeagueId).catch(() => null),
    ...weekFetches,
  ])
  if (!rosters || !users) return null

  const lastTxByRoster = new Map<number, number>()
  for (const w of weeks) {
    for (const t of w ?? []) {
      if (t.status !== 'complete') continue
      for (const rid of t.roster_ids ?? []) {
        lastTxByRoster.set(rid, Math.max(lastTxByRoster.get(rid) ?? 0, t.created))
      }
    }
  }
  const usersById = new Map(users.map((u) => [u.user_id, u]))
  const trendByOwner = new Map((h2h?.managers ?? []).map((m) => [m.ownerId, m.trend] as const))
  const now = Date.now()

  const managers: PulseManager[] = rosters.map((r) => {
    const ownerId = r.owner_id
    const user = ownerId ? usersById.get(ownerId) : undefined
    const emptyStarters = (r.starters ?? []).filter((s) => !s || s === '0').length
    const lastTx = lastTxByRoster.get(r.roster_id) ?? null
    const daysSinceTx = lastTx ? Math.floor((now - lastTx) / 86_400_000) : null
    const trend = ownerId ? trendByOwner.get(ownerId) ?? null : null

    const signals: string[] = []
    if (!ownerId) signals.push('orphan roster (no owner)')
    if (emptyStarters > 0) signals.push(`${emptyStarters} empty starter slot${emptyStarters === 1 ? '' : 's'}`)
    if (daysSinceTx == null) signals.push('no completed transactions this season')
    else if (daysSinceTx >= PULSE_STALE_DAYS) signals.push(`no transactions in ${daysSinceTx} days`)
    if (trend === 'down') signals.push('scoring trending down (last 3 wks vs season avg)')

    return {
      rosterId: r.roster_id,
      ownerId,
      name: user?.display_name ?? 'Orphan team',
      teamName: user?.metadata?.team_name?.trim() || null,
      avatar: user?.avatar ?? null,
      emptyStarters,
      daysSinceTx,
      trend,
      signals,
      flagged: signals.length >= 2,
    }
  })
  managers.sort((a, b) => b.signals.length - a.signals.length)

  return {
    version: 1,
    fetchedAt: new Date().toISOString(),
    flaggedCount: managers.filter((m) => m.flagged).length,
    managers,
    method: `Flagged when ≥2 counted signals fire: empty starter slots, ${PULSE_STALE_DAYS}+ days without a transaction (or none all season), downward scoring trend, orphan roster.`,
  }
}
