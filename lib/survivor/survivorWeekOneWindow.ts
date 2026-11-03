/**
 * The week-1 partial scoring window — pure. The original league: "Week 1: Thursday and Friday players
 * will not count." The commissioner names the first Eastern weekday of week 1 that counts; every
 * starter whose game kicked off on an earlier Eastern day scores zero toward the Survivor week-1 total.
 *
 * Survivor scoring only (lib/survivor/gameStateMachine.ts → SurvivorWeeklyScore); the base league's
 * own matchup scores are untouched. Weekly-kickoff sports only (NFL, NCAAF), where a player has one
 * game a week: a daily sport's player plays several times a week, so excluding his first game would
 * exclude the whole week.
 */
import type { SurvivorGovernanceDay } from './survivorGovernanceSettings'

export const WEEK_ONE_WINDOW_SPORTS: readonly string[] = ['NFL', 'NCAAF']

const DAY_INDEX: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }
const easternDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })

/** 'YYYY-MM-DD' of an instant in US Eastern. */
export function easternDateKey(instant: Date): string {
  return easternDate.format(instant)
}

function addDays(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The first Eastern date of week 1 that counts: the first `startDay` on or after the week's first
 * kickoff. Null when the week has no kickoff on record (then nothing is excluded).
 */
export function weekOneCutoffDay(firstKickoff: Date | null, startDay: SurvivorGovernanceDay): string | null {
  if (!firstKickoff) return null
  const first = easternDateKey(firstKickoff)
  for (let i = 0; i < 7; i++) {
    const key = addDays(first, i)
    if (new Date(`${key}T12:00:00Z`).getUTCDay() === DAY_INDEX[startDay]) return key
  }
  return null
}

export function isBeforeCutoff(kickoff: Date | null, cutoffDay: string | null): boolean {
  return Boolean(kickoff && cutoffDay && easternDateKey(kickoff) < cutoffDay)
}

/** Points the window removes: starters whose game kicked off before the cutoff day. */
export function weekOneExcludedPoints(
  playerPoints: ReadonlyArray<{ playerId: string; points: number; isStarter: boolean }>,
  kickoffByPlayer: ReadonlyMap<string, Date | null>,
  cutoffDay: string | null,
): number {
  if (!cutoffDay) return 0
  let removed = 0
  for (const p of playerPoints) {
    if (p.isStarter && isBeforeCutoff(kickoffByPlayer.get(p.playerId) ?? null, cutoffDay)) removed += p.points
  }
  return Math.round(removed * 100) / 100
}
