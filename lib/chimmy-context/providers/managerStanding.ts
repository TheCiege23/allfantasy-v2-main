import { prisma } from "@/lib/prisma"
import { divisionBand } from "@/lib/class-rating/divisionGate"
import { getManagerClass } from "@/lib/class-rating/reads"
import { GLICKO } from "@/lib/class-rating/engine"
import type { RankingContextSlice } from "@/lib/chimmy-context/types"

/**
 * The manager's standing — experience level and Class — for Chimmy's ranking context, so "why did
 * I drop" and "what leagues can I join" are answered from the same numbers the Rankings tab shows.
 *
 * Ported from PR #1753 onto the Class core (owner ruling, 2026-10-01): the level is the XP ladder
 * and is EXPERIENCE ONLY — what league joins are matched on is the Class division (ADR F2.10a),
 * never XP. Reads what is stored; never throws; a missing piece is simply absent.
 */
export type ManagerStanding = Pick<RankingContextSlice, "managerLevel" | "classRange" | "skillLines">

export async function loadManagerStanding(userId: string): Promise<ManagerStanding> {
  const [profile, cls] = await Promise.all([
    prisma.userProfile
      .findUnique({ where: { userId }, select: { xpLevel: true, legacyCareerLevel: true } })
      .catch(() => null),
    getManagerClass(userId),
  ])

  const out: ManagerStanding = {}
  const level = profile?.xpLevel ?? profile?.legacyCareerLevel ?? null
  if (level != null && Number.isFinite(Number(level))) out.managerLevel = Math.max(1, Math.floor(Number(level)))

  if (cls.status === "established") {
    const [lo, hi] = divisionBand(cls.division)
    const band = lo === hi ? `Division ${lo}` : `Divisions ${lo}–${hi}`
    out.classRange =
      `Division ${cls.division} (Class ${cls.classLevel}) — public leagues match this manager with ${band}. ` +
      `A commissioner can invite them into any league; such a join is allowed and flagged.`
    out.skillLines = [
      `NFL Class ${cls.classLevel} (Division ${cls.division}), rating ${Math.round(cls.rating)} ±${Math.round(cls.rd)}, ` +
        `top ${Math.max(1, Math.round((1 - cls.percentile) * 100))}% of established managers, ${cls.games} rated weeks ` +
        `(all-play: rated on how they scored against their whole league each week; rated ${cls.computedAt.slice(0, 10)})`,
    ]
  } else if (cls.status === "provisional") {
    out.classRange = `Provisional — no Class yet, so no league turns this manager away (they are flagged as provisional).`
    out.skillLines = [
      `NFL rating ${Math.round(cls.rating)} ±${Math.round(cls.rd)}, provisional until the ± is ${GLICKO.establishedRd} or less, ` +
        `${cls.games} rated weeks (rated ${cls.computedAt.slice(0, 10)})`,
    ]
  }
  return out
}
