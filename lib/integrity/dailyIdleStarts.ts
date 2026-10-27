import type { PrismaClient } from '@prisma/client'

import { isRuledOut } from '@/lib/core-app/injuryStatus'
import { canFillSlotForSport } from '@/lib/core-app/sportSlotEligibility'
import { dailySlotFor, dayKey, daysInWindow, daysOnRoster, droppedInWindow, loadDailyLineups, type DailyLineups } from '@/lib/redraft/dailyLineups'
import { buildWeekKickoffMap, lockTeamLookupKeys } from '@/lib/redraft/lineupLock'
import { loadWeekLineups, weekSlotType, type WeekLineups } from '@/lib/redraft/weekLineupSlots'
import { isNflRedraftScoringStarterSlot } from '@/lib/scoring-runtime/canonicalNflRedraftScoringRuntime'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'

/**
 * The tanking evidence of a DAILY-LINEUP league (NBA / NHL / MLB with `dailyLineupsEnabled`): who was
 * started on a day his team had no game, while the bench held someone who played that day and could
 * have taken the slot. It is the daily form of NFL's "started a player on a bye".
 *
 * The weekly lineup card the native scan reads (./nativeLineupCards.ts) is the wrong record here: a
 * daily league is scored day by day on that day's starters (lib/redraft/dailyLineups.ts), so this reads
 * each day's slot with the scorer's own rule — that day's saved row, else the latest earlier one, else
 * the weekly lineup — and only the days each player was on the roster (`daysOnRoster`).
 *
 * ⚠ AN UNMATCHED TEAM NEVER COUNTS. A team is "idle on a day" only when the schedule places it on OTHER
 * days of the same week. A team the schedule never names (a spelling the two feeds disagree on — the
 * lock code records that NBA's two spellings have not been compared) is unknown, and an accusation
 * cannot rest on an unknown.
 *
 * ⚠ ONE BENCH PLAYER COVERS ONE IDLE SLOT A DAY. Two idle starters and one usable bench player is one
 * wasted start, not two.
 */

export type DailyRosterPlayer = {
  rosterId: string
  playerId: string
  playerName: string | null
  position: string | null
  slotType: string
  team: string | null
  injuryStatus: string | null
  addedAt?: Date | null
  droppedAt?: Date | null
}

export type IdleStart = {
  day: string
  slot: string
  playerId: string
  playerName: string
  /** The bench player who played that day and could have taken the slot. */
  benchPlayerId: string
  benchPlayerName: string
}

export type DailyRosterFindings = {
  idleStarts: IdleStart[]
  /** Started on a day his team played, and listed Out / IR as last synced (not as it was that day). */
  ruledOutStarters: Array<{ playerId: string; playerName: string; status: string }>
}

const isBench = (slot: string | null | undefined) => {
  const s = String(slot ?? '').trim().toLowerCase()
  return s === 'bench' || s === 'bn'
}

/** Pure: each roster's findings for the week, from the rows, the lineups and the team schedule. */
export function findDailyIdleStarts(args: {
  sport: string
  days: readonly Date[]
  players: readonly DailyRosterPlayer[]
  weekLineups: WeekLineups
  dailyLineups: DailyLineups
  /** Team key → Eastern days ('YYYY-MM-DD') it played this week. */
  teamDays: ReadonlyMap<string, ReadonlySet<string>>
  teamKey: (team: string | null) => string
}): Map<string, DailyRosterFindings> {
  const out = new Map<string, DailyRosterFindings>()
  const gameDays = (p: DailyRosterPlayer) => args.teamDays.get(args.teamKey(p.team)) ?? null
  const name = (p: DailyRosterPlayer) => p.playerName?.trim() || p.playerId

  const byRoster = new Map<string, DailyRosterPlayer[]>()
  for (const p of args.players) byRoster.set(p.rosterId, [...(byRoster.get(p.rosterId) ?? []), p])

  for (const [rosterId, players] of byRoster) {
    const findings: DailyRosterFindings = { idleStarts: [], ruledOutStarters: [] }
    const ruledOut = new Set<string>()
    for (const day of args.days) {
      const key = dayKey(day)
      const here = players.filter((p) => daysOnRoster(p, [day]).length > 0)
      const slotOf = (p: DailyRosterPlayer) => dailySlotFor(args.dailyLineups, rosterId, p.playerId, day) ?? weekSlotType(p, args.weekLineups)
      const starters = here.filter((p) => isNflRedraftScoringStarterSlot(slotOf(p)))
      // Bench players who played today and were available: each can cover one idle slot.
      const spare = here.filter((p) => isBench(slotOf(p)) && gameDays(p)?.has(key) && !isRuledOut(p.injuryStatus))

      for (const s of starters) {
        const days = gameDays(s)
        if (!days) continue // unknown team: no claim
        if (days.has(key)) {
          if (isRuledOut(s.injuryStatus) && !ruledOut.has(s.playerId)) {
            ruledOut.add(s.playerId)
            findings.ruledOutStarters.push({ playerId: s.playerId, playerName: name(s), status: String(s.injuryStatus) })
          }
          continue
        }
        const slot = slotOf(s)
        const i = spare.findIndex((b) => canFillSlotForSport(args.sport, slot, b.position))
        if (i < 0) continue // nobody could have taken the slot: not a wasted start
        const [bench] = spare.splice(i, 1)
        findings.idleStarts.push({ day: key, slot, playerId: s.playerId, playerName: name(s), benchPlayerId: bench.playerId, benchPlayerName: name(bench) })
      }
    }
    if (findings.idleStarts.length || findings.ruledOutStarters.length) out.set(rosterId, findings)
  }
  return out
}

/** The week's findings for a daily-lineup league, read from what was stored. Null when the week has no window. */
export async function loadDailyIdleStarts(
  db: PrismaClient,
  args: { sport: string; season: number; week: number; redraftRosterIds: readonly string[] },
): Promise<Map<string, DailyRosterFindings> | null> {
  const sport = args.sport.toUpperCase()
  const window = resolveDailySportWeekWindow(sport, args.season, args.week)
  if (!window || args.redraftRosterIds.length === 0) return null
  const rosterIds = [...args.redraftRosterIds]
  const [players, weekLineups, dailyLineups, kickoffs] = await Promise.all([
    db.redraftRosterPlayer.findMany({
      where: { rosterId: { in: rosterIds }, ...droppedInWindow(window) },
      select: { rosterId: true, playerId: true, playerName: true, position: true, slotType: true, team: true, injuryStatus: true, addedAt: true, droppedAt: true },
    }),
    loadWeekLineups(db, { redraftRosterIds: rosterIds, season: args.season, week: args.week }),
    loadDailyLineups(db, { redraftRosterIds: rosterIds, window }),
    buildWeekKickoffMap(db, { sport, season: args.season, week: args.week }),
  ])
  const teamDays = new Map<string, Set<string>>()
  for (const [team, byDay] of kickoffs.byTeamDay ?? new Map()) teamDays.set(team, new Set(byDay.keys()))
  return findDailyIdleStarts({
    sport,
    days: daysInWindow(window),
    players,
    weekLineups,
    dailyLineups,
    teamDays,
    teamKey: (team) => lockTeamLookupKeys(sport, team)[0] ?? '',
  })
}
