/**
 * The college board, priced for ONE franchise rather than in the abstract.
 *
 * ⚠ THIS IS THE WHOLE POINT OF LINKING THE TWO LEAGUES. A college running back
 * is worth more to a manager who is thin at running back in the pro league — and
 * only if he arrives before that hole closes. Two separate leagues cannot see
 * either half of that sentence; a franchise can.
 *
 * Rules live in crossHalfNeed.ts and devyTradeValue.ts. This resolves them
 * against the franchise's real rosters.
 */

import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  computeRosterNeed,
  readSlotRequirements,
  type RosterNeed,
} from '@/lib/trade-intel/rosterNeed'
import { projectDevyOutlook } from '@/lib/trade-intel/devyOutlook'
import { devyAssetValue } from '@/lib/trade-intel/devyTradeValue'
import { applyCrossHalfNeed, crossHalfNeedFactor, type CrossHalfNeed } from './crossHalfNeed'
import { findRosterForTeam, rosterPlayerIds } from '@/lib/leagues/rosterForTeam'

/**
 * The pro half's roster need, computed from real positions.
 *
 * ⚠ SLEEPER STORES PLATFORM IDS, NOT POSITIONS, so positions are resolved
 * through `Player.provider_ids` on an exact id join.
 *
 * ⚠ AND THAT ID IS STORED PREFIXED (`"sleeper:14039"`) while cfbd and
 * rolling_insights are bare — so a reader matching the raw value silently finds
 * nothing. Both spellings are queried.
 *
 * Returns null when the lineup or roster cannot be read, so the caller reports
 * absence rather than a confident need for a roster it cannot see.
 */
export async function loadProNeed(linkId: string): Promise<RosterNeed | null> {
  const member = await prisma.franchiseLeagueMember.findFirst({
    where: { linkId, role: 'pro' },
    select: { leagueId: true, teamExternalId: true },
  })
  if (!member?.teamExternalId) return null

  const league = await prisma.league.findUnique({
    where: { id: member.leagueId },
    select: { starters: true },
  })
  const requirements = readSlotRequirements(league?.starters)
  if (!requirements) return null

  const team = await prisma.leagueTeam.findFirst({
    where: { leagueId: member.leagueId, externalId: member.teamExternalId },
    select: { platformUserId: true },
  })
  if (!team?.platformUserId) return null

  /* Contract-aware: a linked manager's roster is keyed by their AF id, not the
     Sleeper id on the team row. See rosterLookup.ts. */
  const roster = await findRosterForTeam(member.leagueId, team.platformUserId)
  const ids = roster ? rosterPlayerIds(roster.playerData) : null
  if (!ids || ids.length === 0) return null

  const keys = [...ids, ...ids.map((i) => `sleeper:${i}`)]
  const players = await prisma.$queryRaw<Array<{ position: string | null }>>`
    SELECT position FROM "Player"
     WHERE provider_ids::jsonb->>'sleeper' = ANY(${keys})
  `

  const rostered = players.map((p) => p.position).filter((p): p is string => Boolean(p))
  if (rostered.length === 0) return null

  return computeRosterNeed({ requirements, rostered })
}

export type CollegeAssetForFranchise = {
  name: string
  position: string | null
  /** Devy points before this franchise's own shape is considered. */
  boardValue: number | null
  /** Devy points after the pro half's holes are priced in. */
  franchiseValue: number | null
  need: CrossHalfNeed
  basis: string
}

/** "Smith, Jeremiah" and "Jeremiah Smith" both become "jeremiah smith". */
function normalizeName(raw: string): string {
  const s = raw.includes(',')
    ? raw.split(',').map((x) => x.trim()).reverse().join(' ')
    : raw
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function loadCollegeBoardForFranchise(
  linkId: string,
  currentSeason = new Date().getFullYear(),
): Promise<CollegeAssetForFranchise[] | null> {
  const member = await prisma.franchiseLeagueMember.findFirst({
    where: { linkId, role: 'college' },
    select: { leagueId: true },
  })
  if (!member) return null

  const league = await prisma.fantraxLeague.findUnique({
    where: { id: member.leagueId },
    select: { roster: true },
  })
  const raw = Array.isArray(league?.roster) ? (league.roster as unknown[]) : null
  if (!raw) return null

  const proNeed = await loadProNeed(linkId)

  const rows = raw.map((r) => r as Record<string, unknown>)
  const keys = rows.map((r) => normalizeName(String(r.name ?? '')))

  const devyRows = await prisma.devyPlayer.findMany({
    where: { normalizedName: { in: keys.filter(Boolean) } },
    select: {
      normalizedName: true,
      name: true,
      position: true,
      draftEligibleYear: true,
      draftProjectionScore: true,
      recruitingComposite: true,
      breakoutAge: true,
      projectedDraftRound: true,
      devyAdp: true,
    },
  })
  const byName = new Map(devyRows.map((d) => [d.normalizedName, d]))

  /*
   * ⚠ RANKED AGAINST THE WHOLE EVIDENCED CLASS, NOT THIS ROSTER. Ranking a
   * roster against itself makes every player on it a top-of-board asset.
   */
  const boardPool = await prisma.devyPlayer.findMany({
    where: { graduatedToNFL: false, draftProjectionScore: { not: null } },
    select: { draftProjectionScore: true },
  })
  const descending = boardPool
    .map((b) => b.draftProjectionScore as number)
    .sort((a, b) => b - a)

  const rankOf = (score: number | null): number | null => {
    if (score == null) return null
    let lo = 0
    let hi = descending.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (descending[mid] > score) lo = mid + 1
      else hi = mid
    }
    return lo + 1
  }

  return rows.map((row, i) => {
    const label = String(row.name ?? 'Unknown')
    const devy = byName.get(keys[i])

    if (!devy) {
      return {
        name: label,
        position: (row.position as string) ?? null,
        boardValue: null,
        franchiseValue: null,
        need: crossHalfNeedFactor({
          position: (row.position as string) ?? null,
          proNeed,
          arrivalYears: null,
          name: label,
        }),
        basis: `${label} is not on our devy board, so he carries no value here. That is an absence of data, not a low rating.`,
      }
    }

    const outlook = projectDevyOutlook({
      player: devy,
      draftEligibleYear: devy.draftEligibleYear,
      currentSeason,
      name: devy.name,
    })
    const value = devyAssetValue({
      devyRank: rankOf(devy.draftProjectionScore),
      outlook,
      name: devy.name,
    })
    const need = crossHalfNeedFactor({
      position: devy.position,
      proNeed,
      arrivalYears: outlook.horizonYears,
      name: devy.name,
    })

    return {
      name: devy.name,
      position: devy.position,
      boardValue: value.value,
      franchiseValue: applyCrossHalfNeed(value.value, need),
      need,
      basis: `${value.basis} ${need.basis}`,
    }
  })
}
