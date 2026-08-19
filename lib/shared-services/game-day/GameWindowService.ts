/**
 * Game Window Service — Phase 9. Groups real FantasyScheduleGame rows
 * (prisma/schema.prisma — the confirmed real, provider-sourced schedule
 * table with a real `kickoffTime`/`status` field) into deterministic windows.
 *
 * NFL/NCAAF get real day-part windows (Thursday/Sunday-early/Sunday-late/
 * Sunday-night/Monday) derived from each game's real kickoff day-of-week and
 * hour (ET) — not hardcoded into the shared type layer (GameWindow itself is
 * sport-generic; only this file's grouping strategy is NFL/NCAAF-specific).
 * Other sports (NBA/MLB/NHL) get a single real daily-slate window per date,
 * matching the audit's finding that non-NFL lineup locks are currently
 * handled as a single daily cutoff (lib/league/lineup-lock.ts's
 * dailySportLock()), not per-game-window granularity — this service doesn't
 * invent per-game precision those sports' real lock logic doesn't have.
 */

import { prisma } from '@/lib/prisma'
import type { GameWindow } from './types'

const NFL_LIKE_SPORTS = new Set(['NFL', 'NCAAF'])

function etHourAndDay(date: Date): { day: number; hour: number } {
  const et = new Date(date.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return { day: et.getDay(), hour: et.getHours() }
}

function nflWindowLabel(kickoff: Date): { id: string; label: string } {
  const { day, hour } = etHourAndDay(kickoff)
  if (day === 4) return { id: 'thursday', label: 'Thursday Night' }
  if (day === 1) return { id: 'monday', label: 'Monday Night' }
  if (day === 0) {
    if (hour < 13) return { id: 'sunday_early', label: 'Sunday Early' }
    if (hour < 17) return { id: 'sunday_late', label: 'Sunday Late' }
    return { id: 'sunday_night', label: 'Sunday Night' }
  }
  return { id: `other_${day}`, label: 'Other' }
}

export interface ComputeGameWindowsInput {
  sport: string
  season: string
  week: number
}

export async function computeGameWindows(input: ComputeGameWindowsInput): Promise<GameWindow[]> {
  const games = await prisma.fantasyScheduleGame.findMany({
    where: { sport: input.sport, season: input.season, week: input.week },
    select: { kickoffTime: true },
  })

  const withKickoff = games.filter((g): g is { kickoffTime: Date } => g.kickoffTime != null)
  if (withKickoff.length === 0) return []

  const groups = new Map<string, { label: string; times: Date[] }>()

  if (NFL_LIKE_SPORTS.has(input.sport.toUpperCase())) {
    for (const g of withKickoff) {
      const { id, label } = nflWindowLabel(g.kickoffTime)
      const existing = groups.get(id) ?? { label, times: [] }
      existing.times.push(g.kickoffTime)
      groups.set(id, existing)
    }
  } else {
    // Non-NFL: one window per calendar date (ET) — matches the real daily-slate
    // lock granularity this codebase actually implements for these sports.
    for (const g of withKickoff) {
      const et = new Date(g.kickoffTime.toLocaleString('en-US', { timeZone: 'America/New_York' }))
      const dateKey = et.toISOString().slice(0, 10)
      const existing = groups.get(dateKey) ?? { label: `${input.sport} Slate — ${dateKey}`, times: [] }
      existing.times.push(g.kickoffTime)
      groups.set(dateKey, existing)
    }
  }

  return Array.from(groups.entries()).map(([id, { label, times }]) => {
    const sorted = [...times].sort((a, b) => a.getTime() - b.getTime())
    return {
      id,
      sport: input.sport,
      label,
      startTime: sorted[0]?.toISOString() ?? null,
      endTime: sorted[sorted.length - 1]?.toISOString() ?? null,
      gameCount: times.length,
    }
  })
}
