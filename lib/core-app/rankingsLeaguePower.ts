import 'server-only'

import { prisma } from '@/lib/prisma'
import { getPowerRankingSnapshotsForLeague } from '@/lib/power-rankings-dashboard/getPowerRankingSnapshotsForLeague'
import type { SnapshotTeamRow } from '@/lib/power-rankings-dashboard/snapshotTeamRow'

/**
 * MFL ids are zero-padded and lose the padding in some tables — compare numerically. Inlined from
 * PR #1753's `loadRatedGames.ts`, which the Class port drops; this module was its only other user.
 */
function slotKey(slot: string | number): string {
  const s = String(slot).trim()
  return /^\d+$/.test(s) ? String(Number(s)) : s
}

/**
 * The power view of one league on `/core/rankings?scope=league` — what the old
 * `/rankings` page showed (power score, trend, strengths and risks), now inside
 * the rankings hub.
 *
 * ⚠ STORED DATA ONLY. `computePowerRankings` and `/api/rankings/league-v2` call
 * Sleeper live (and the commentary route calls OpenAI), so neither belongs on a
 * page render. This reads:
 *   - the latest `LeaguePowerRankingSnapshot` (`current_power`), written when
 *     anyone in the league runs Power rankings
 *   - `LeagueTeam.strengthNotes` / `riskNotes`, written by the AI refresh
 * and says so when neither exists, rather than computing anything.
 *
 * ⚠ `isCurrentUser` IN A SNAPSHOT IS WHOEVER RAN IT. The viewer's own team is
 * recomputed here from the team they claimed.
 */

export type LeaguePowerRow = {
  rank: number
  name: string
  powerScore: number
  /** Places moved since the previous snapshot: + is up. */
  move: number | null
  tier: string | null
  momentum: string | null
  record: string | null
  isYou: boolean
}

export type LeaguePowerView = {
  rows: LeaguePowerRow[]
  week: number
  season: number
  computedAt: string
  /** Your team's stored strengths and risks, when an AI refresh has written them. */
  yours: { name: string; strengths: string | null; risks: string | null } | null
} | null

function asRows(teams: unknown): SnapshotTeamRow[] {
  if (!Array.isArray(teams)) return []
  return teams.filter(
    (t): t is SnapshotTeamRow =>
      !!t && typeof t === 'object' && typeof (t as SnapshotTeamRow).rank === 'number' && typeof (t as SnapshotTeamRow).powerScore === 'number',
  )
}

export async function getLeaguePower(leagueId: string, userId: string): Promise<LeaguePowerView> {
  const [snaps, teams] = await Promise.all([
    getPowerRankingSnapshotsForLeague({ leagueId, rankingMode: 'current_power', limit: 1 }).catch(() => []),
    prisma.leagueTeam
      .findMany({
        where: { leagueId },
        select: { externalId: true, teamName: true, claimedByUserId: true, strengthNotes: true, riskNotes: true },
      })
      .catch(() => []),
  ])
  const snap = snaps[0]
  if (!snap) return null

  const mine = teams.find((t) => t.claimedByUserId === userId) ?? null
  const mySlot = mine ? slotKey(mine.externalId) : null
  const rows = asRows(snap.teams)
    .sort((a, b) => a.rank - b.rank)
    .map((t) => {
      const isYou = mySlot != null && t.externalId != null ? slotKey(t.externalId) === mySlot : false
      return {
        rank: t.rank,
        name: t.teamName?.trim() || 'Team',
        powerScore: t.powerScore,
        move: t.rankDelta ?? (t.prevRank != null ? t.prevRank - t.rank : null),
        tier: t.tierLabel ?? t.tier ?? null,
        momentum: t.momentumLabel ?? null,
        record: t.record ? `${t.record.wins}-${t.record.losses}${t.record.ties ? `-${t.record.ties}` : ''}` : null,
        isYou,
      }
    })
  if (rows.length === 0) return null

  const notes = mine && (mine.strengthNotes?.trim() || mine.riskNotes?.trim())
  return {
    rows,
    week: snap.week,
    season: snap.season,
    computedAt: snap.computedAt.toISOString(),
    yours: mine && notes
      ? { name: mine.teamName, strengths: mine.strengthNotes?.trim() || null, risks: mine.riskNotes?.trim() || null }
      : null,
  }
}
