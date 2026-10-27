/**
 * The commissioner-lens tiles of the Premium Survivor command center, as pure functions. They only
 * ever reach a commissioner or co-commissioner on AF Commissioner (or Supreme), and the fairness
 * shield still holds: a commissioner who PLAYS sees aggregates only. Who missed a ballot is shown
 * to a non-playing host alone, and no tile ever names whom anyone voted for.
 *
 * Client-safe: no I/O.
 */

import { SURVIVOR_HOST_USER_ID } from '@/lib/survivor/survivorTribeRedrawActions'

// ── Mini-game planner ────────────────────────────────────────────────────────

export type MinigamePlannerWeek = {
  week: number
  isCurrent: boolean
  challenges: Array<{
    title: string
    scope: 'tribe' | 'individual'
    status: 'scheduled' | 'open' | 'locked' | 'settled'
    winner: string | null
  }>
  /** The weekly call (bragging rights): is it posted, and how many have answered. */
  weeklyCall: { posted: boolean; answers: number } | null
}

export type MinigamePlannerTile = {
  currentWeek: number
  /** True when Chimmy runs challenges (the default); otherwise the commissioner does. */
  systemRun: boolean
  weeks: MinigamePlannerWeek[]
  /** Challenge wins so far, so one tribe or manager running away with them is easy to spot. */
  winsByTribe: Array<{ name: string; wins: number }>
}

const SETTLED = new Set(['settled', 'complete', 'completed', 'scored', 'resolved', 'closed'])

export function buildMinigamePlannerTile(input: {
  currentWeek: number
  systemRun: boolean
  /** Weeks the season plays, from the plan; challenges can exist for any of them. */
  seasonWeeks: readonly number[]
  now: Date
  tribeNames: Readonly<Record<string, string>>
  playerNames: Readonly<Record<string, string>>
  challenges: ReadonlyArray<{
    week: number; title: string; challengeType: string; scope: string; status: string
    locksAt: Date | null; closesAt: Date | null; winnerTribeId: string | null; winnerUserIds: readonly string[]
  }>
  weeklyCalls: ReadonlyArray<{ week: number; answers: number }>
}): MinigamePlannerTile {
  const byWeek = new Map<number, MinigamePlannerWeek['challenges']>()
  const tribeWins = new Map<string, number>()
  for (const c of input.challenges) {
    const lock = c.locksAt ?? c.closesAt
    const settled = SETTLED.has(c.status)
    const status: MinigamePlannerWeek['challenges'][number]['status'] = settled ? 'settled' : lock && lock <= input.now ? 'locked' : c.week > input.currentWeek ? 'scheduled' : 'open'
    const winner = settled
      ? c.winnerTribeId ? input.tribeNames[c.winnerTribeId] ?? null : c.winnerUserIds.map(id => input.playerNames[id]).filter(Boolean).join(', ') || null
      : null
    if (settled && c.winnerTribeId) tribeWins.set(c.winnerTribeId, (tribeWins.get(c.winnerTribeId) ?? 0) + 1)
    const list = byWeek.get(c.week) ?? []
    list.push({ title: c.title || c.challengeType.replace(/_/g, ' '), scope: c.scope === 'individual' ? 'individual' : 'tribe', status, winner })
    byWeek.set(c.week, list)
  }
  const calls = new Map(input.weeklyCalls.map(call => [call.week, call.answers]))
  // The current week, the two before it and the two after: the planning window a host acts in.
  const window = new Set(input.seasonWeeks.filter(w => w >= input.currentWeek - 2 && w <= input.currentWeek + 2))
  for (const w of byWeek.keys()) if (w >= input.currentWeek - 2 && w <= input.currentWeek + 2) window.add(w)
  const weeks = [...window].sort((a, b) => a - b).map(week => ({
    week,
    isCurrent: week === input.currentWeek,
    challenges: byWeek.get(week) ?? [],
    weeklyCall: calls.has(week) ? { posted: true, answers: calls.get(week) ?? 0 } : week <= input.currentWeek ? { posted: false, answers: 0 } : null,
  }))
  return {
    currentWeek: input.currentWeek,
    systemRun: input.systemRun,
    weeks,
    winsByTribe: [...tribeWins].map(([id, wins]) => ({ name: input.tribeNames[id] ?? 'A former tribe', wins })).sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name)),
  }
}

// ── Risk alerts ──────────────────────────────────────────────────────────────

export type RiskAlertsTile = {
  flags: Array<{ kind: 'collusion' | 'tanking' | 'other'; severity: string; summary: string; teams: string[]; raisedAt: string }>
  quiet: Array<{ name: string; lastMessageAt: string | null; missedBallots: number | null }>
  /** False for a commissioner who also plays: missed ballots stay sealed for them. */
  showsMissedBallots: boolean
  quietDays: number
}

export const RISK_QUIET_DAYS = 14

/**
 * The integrity flags still open, and the managers who have gone quiet: no message in any Survivor
 * chat for two weeks, or (for a non-playing host) ballots Chimmy had to cast for them.
 */
export function buildRiskAlertsTile(input: {
  now: Date
  blind: boolean
  flags: ReadonlyArray<{ flagType: string; severity: string; summary: string; affectedTeamNames: readonly string[]; createdAt: Date }>
  activeCast: ReadonlyArray<{ userId: string; displayName: string }>
  lastMessageAt: ReadonlyMap<string, Date>
  autoCastCount: ReadonlyMap<string, number>
}): RiskAlertsTile {
  const cutoff = input.now.getTime() - RISK_QUIET_DAYS * 86_400_000
  const quiet = input.activeCast
    .map(p => {
      const last = input.lastMessageAt.get(p.userId) ?? null
      const missed = input.blind ? null : input.autoCastCount.get(p.userId) ?? 0
      return { name: p.displayName, lastMessageAt: last?.toISOString() ?? null, missedBallots: missed, silent: !last || last.getTime() < cutoff }
    })
    .filter(p => p.silent || (p.missedBallots ?? 0) > 0)
    .sort((a, b) => (b.missedBallots ?? 0) - (a.missedBallots ?? 0) || (a.lastMessageAt ?? '').localeCompare(b.lastMessageAt ?? '') || a.name.localeCompare(b.name))
    .map(({ silent: _silent, ...row }) => row)
  return {
    flags: input.flags.map(f => ({
      kind: f.flagType === 'collusion' ? 'collusion' : f.flagType === 'tanking' ? 'tanking' : 'other',
      severity: f.severity,
      summary: f.summary,
      teams: [...f.affectedTeamNames],
      raisedAt: f.createdAt.toISOString(),
    })),
    quiet,
    showsMissedBallots: !input.blind,
    quietDays: RISK_QUIET_DAYS,
  }
}

// ── Fairness radar ───────────────────────────────────────────────────────────

export type FairnessRadarTile = {
  councils: number
  ties: { total: number; settledByCommissioner: number }
  autoCastBallots: number
  lateBallots: number
  scoreCorrections: number
  /** Manual commissioner actions, newest first. Chimmy's automatic ones are counted, not listed. */
  overrides: Array<{ week: number | null; action: string; description: string; at: string }>
  automaticActions: number
}

export function buildFairnessRadarTile(input: {
  councils: ReadonlyArray<{ isTie: boolean; tiePhase: string | null }>
  tieDecisions: number
  autoCastBallots: number
  lateBallots: number
  scoreCorrections: number
  actions: ReadonlyArray<{ week: number | null; actionType: string; description: string; commissionerId: string; executedAt: Date }>
}): FairnessRadarTile {
  const manual = input.actions.filter(a => a.commissionerId !== SURVIVOR_HOST_USER_ID)
  return {
    councils: input.councils.length,
    ties: { total: input.councils.filter(c => c.isTie || c.tiePhase).length, settledByCommissioner: input.tieDecisions },
    autoCastBallots: input.autoCastBallots,
    lateBallots: input.lateBallots,
    scoreCorrections: input.scoreCorrections,
    overrides: [...manual]
      .sort((a, b) => b.executedAt.getTime() - a.executedAt.getTime())
      .slice(0, 12)
      .map(a => ({ week: a.week, action: a.actionType.replace(/_/g, ' '), description: a.description, at: a.executedAt.toISOString() })),
    automaticActions: input.actions.length - manual.length,
  }
}

export type SurvivorHostTilePayload =
  | { tileId: 'minigame_planner'; data: MinigamePlannerTile }
  | { tileId: 'risk_alerts'; data: RiskAlertsTile }
  | { tileId: 'host_fairness_radar'; data: FairnessRadarTile }
