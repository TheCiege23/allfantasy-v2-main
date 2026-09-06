import type { ManagerPresence, PresenceManager } from './managerPresence'
import { inWindow, localParts, type ActivityWindow } from './managerActivityWindow'
import { pitchLine, type PitchLine, type PitchPackage } from './tradePitch'

/**
 * Trade windows across every league where someone else has him — the core
 * view's answer to "who is most reachable this week?"
 *
 * The single-league card (TradeWindow.tsx) reads one league's presence. In
 * the core view a player is usually held by different managers in different
 * leagues, and the question is which of them to pitch first. This takes the
 * owner row from each league's presence and orders them by reachability:
 *
 *   1. inside their usual window right now;
 *   2. a window that opens soonest, in the league's own zone;
 *   3. no window (nothing ingested, or moves at no set time) — most recent
 *      move first, then the busiest, then by league name.
 *
 * Pure: everything here is composed from presences the page already loaded.
 * Nothing is invented — a league without ingestion keeps its "no moves
 * ingested yet" lead and sorts last, it is not given a window.
 */

export type TradeWindowRow = {
  leagueId: string
  leagueName: string
  platform: string
  platformLeagueId: string | null
  zone: string
  manager: PresenceManager
  line: PitchLine
  /** Hours until the window next opens in the league's zone; 0 inside it; null without a window. */
  hoursToWindow: number | null
  presence: ManagerPresence
}

/**
 * Hours from `now` to the start of the window's next occurrence, in the
 * league's zone. Whole hours, DST ignored — this orders rows, it does not
 * print a time. 0 when `now` sits inside the block.
 */
export function hoursToWindow(w: ActivityWindow, now: Date, timeZone: string): number {
  const { weekday, hour } = localParts(now, timeZone)
  let days = (w.weekday - weekday + 7) % 7
  if (days === 0) {
    if (hour >= w.startHour && hour < w.endHour) return 0
    if (hour >= w.endHour) days = 7
  }
  return days * 24 + (w.startHour - hour)
}

function ownerOf(p: ManagerPresence): PresenceManager | null {
  return p.managers.find((m) => m.role === 'owner') ?? null
}

/**
 * One row per league where someone else has him, most reachable first.
 * Leagues where he is yours contribute nothing here: there is nobody to pitch
 * for him in them, and the single-league card already lists the buyers.
 */
export function rankTradeWindows(args: { presences: ManagerPresence[]; playerName: string; now: Date; pkg: PitchPackage }): TradeWindowRow[] {
  const { presences, playerName, now, pkg } = args
  const rows: TradeWindowRow[] = []
  for (const p of presences) {
    if (p.holder !== 'other') continue
    const manager = ownerOf(p)
    if (!manager) continue
    const line = pitchLine({ presence: p, manager, playerName, now, pkg })
    const hours = manager.window ? (inWindow(manager.window, now, p.timeZone) ? 0 : hoursToWindow(manager.window, now, p.timeZone)) : null
    rows.push({
      leagueId: p.leagueId,
      leagueName: p.leagueName,
      platform: p.platform,
      platformLeagueId: p.platformLeagueId,
      zone: p.zone,
      manager,
      line,
      hoursToWindow: hours,
      presence: p,
    })
  }

  const rank = (r: TradeWindowRow) => (r.line.timing === 'now' ? 0 : r.line.timing === 'later' ? 1 : 2)
  const lastMoveMs = (r: TradeWindowRow) => (r.manager.lastMove ? new Date(r.manager.lastMove.at).getTime() : 0)
  rows.sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    if (ra === 1) {
      const d = (a.hoursToWindow ?? Infinity) - (b.hoursToWindow ?? Infinity)
      if (d !== 0) return d
    }
    const m = lastMoveMs(b) - lastMoveMs(a)
    if (m !== 0) return m
    if (a.manager.moves !== b.manager.moves) return b.manager.moves - a.manager.moves
    return a.leagueName.localeCompare(b.leagueName)
  })
  return rows
}

/** True when any listed owner moved in the last day — the dot, never "online". */
export function anyMovedToday(rows: TradeWindowRow[], now: Date): boolean {
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000
  return rows.some((r) => r.manager.lastMove && new Date(r.manager.lastMove.at).getTime() >= dayAgo)
}
