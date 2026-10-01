import { prisma } from "@/lib/prisma"
import { classRangeFor } from "@/lib/league-join/managerClass"
import { resolveUserRankLevel } from "@/lib/league-join/resolveJoinRankGate"
import { currentSkill, type ManagerSkill } from "@/lib/rank/skillRating/replay"
import { percentileRank, readSkillBoard } from "@/lib/rank/skillRating/skillRatingStore"
import type { RankingContextSlice } from "@/lib/chimmy-context/types"

/**
 * The manager's standing — level, class and per-sport skill — for Chimmy's
 * ranking context, so "why did I drop" and "what leagues can I join" are answered
 * from the same numbers the Rankings tab shows.
 *
 * Reads what is stored: `UserProfile.xpLevel` and the daily skill board. Never
 * throws; a missing piece is simply absent.
 */
export type ManagerStanding = Pick<RankingContextSlice, "managerLevel" | "classRange" | "skillLines">

export async function loadManagerStanding(userId: string): Promise<ManagerStanding> {
  const [profile, board] = await Promise.all([
    prisma.userProfile
      .findUnique({ where: { userId }, select: { xpLevel: true, legacyCareerLevel: true } })
      .catch(() => null),
    readSkillBoard().catch(() => null),
  ])

  const out: ManagerStanding = {}
  if (profile && (profile.xpLevel != null || profile.legacyCareerLevel != null)) {
    const level = resolveUserRankLevel(profile)
    const range = classRangeFor(level)
    out.managerLevel = level
    out.classRange = `Level ${range.min}–${range.max} (can join leagues in this band; outside it only by a commissioner exception)`
  }

  if (board) {
    const lines: string[] = []
    for (const [sport, sb] of Object.entries(board.sports)) {
      const row = sb.rows.find((r) => r.u === userId)
      if (!row) continue
      const m: ManagerSkill = {
        key: `af:${row.u}`,
        name: null,
        rating: row.r,
        rd: row.rd,
        volatility: row.v,
        games: row.g,
        wins: row.w,
        losses: row.l,
        ties: row.t,
        lastPeriod: row.lp,
        conservative: row.r - 2 * row.rd,
      }
      const now = currentSkill(m, sb.latestPeriod)
      const pct = percentileRank(sb.percentiles, now.conservative)
      const record = row.t ? `${row.w}-${row.l}-${row.t}` : `${row.w}-${row.l}`
      lines.push(
        `${sport} skill ${Math.round(now.rating)} ±${Math.round(now.rd)}` +
          (pct != null ? `, better than ${pct}% of ${sb.rated} rated managers` : "") +
          `, ${row.g} games, ${record} (rated ${board.date})`,
      )
    }
    if (lines.length) out.skillLines = lines
  }
  return out
}
