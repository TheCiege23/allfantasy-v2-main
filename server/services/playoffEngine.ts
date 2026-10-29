/**
 * Playoff seeding from regular-season standings + league playoff settings.
 * Seeding rules: default (by rank), points_only, division_winners_first (when divisions exist).
 */
import { prisma } from '@/lib/prisma'
import { parseSettingsSnapshot } from '@/lib/league-contract/types'
import { getPlayoffSeedingRule } from '@/lib/scoring-engine/scoringSettingsResolved'
import { loadNativePlayoffSeedPreview } from '@/lib/playoff-runtime/playoffSeedPreview'

export type PlayoffSeedRow = { rosterId: string; seed: number; pointsFor: number; wins: number }

export async function computePlayoffSeeds(leagueId: string, season: number): Promise<PlayoffSeedRow[]> {
  // A native season seeds through the playoff runtime — the bracket's own seeding, divisions and the
  // commissioner's tiebreaker order included (lib/playoff-runtime/playoffSeedPreview.ts) — so the stored
  // seeds match the bracket. The ranking below stays for leagues without one.
  const native = await loadNativePlayoffSeedPreview(leagueId, season).catch(() => null)
  if (native && native.seeds.length > 0) return storeNativeSeeds(leagueId, season, native.seeds)

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { playoffTeams: true, playoffSeedingRule: true, settings: true, bestBallMode: true, bbMatchupFormat: true },
  })
  const snap = parseSettingsSnapshot(league?.settings)
  const playoffN =
    snap?.playoffSettings?.playoffTeams ??
    league?.playoffTeams ??
    6

  const n = Math.max(2, Math.min(16, Math.floor(Number(playoffN) || 6)))

  const rule =
    league?.bestBallMode === true && league?.bbMatchupFormat === 'cumulative'
      ? 'points_only'
      : getPlayoffSeedingRule(snap?.playoffSettings ?? null, league?.playoffSeedingRule ?? null)

  let standings = await prisma.fantasyStanding.findMany({
    where: { leagueId, season },
    orderBy: [{ rank: 'asc' }],
  })

  if (rule === 'points_only') {
    standings = [...standings].sort((a, b) => {
      const pf = (Number(b.pointsFor) || 0) - (Number(a.pointsFor) || 0)
      if (pf !== 0) return pf
      return a.rosterId.localeCompare(b.rosterId)
    })
  } else if (rule === 'division_winners_first') {
    standings = await orderStandingsDivisionWinnersFirst(leagueId, season, standings)
  }

  const seeds: PlayoffSeedRow[] = []
  let slot = 1
  for (const row of standings) {
    if (slot > n) break
    seeds.push({
      rosterId: row.rosterId,
      seed: slot,
      pointsFor: Number(row.pointsFor) || 0,
      wins: row.wins ?? 0,
    })
    await prisma.fantasyStanding
      .update({
        where: { leagueId_season_rosterId: { leagueId, season, rosterId: row.rosterId } },
        data: { playoffSeed: slot },
      })
      .catch(() => {})
    slot += 1
  }

  return seeds
}

async function storeNativeSeeds(
  leagueId: string,
  season: number,
  seeds: Array<{ rosterId: string; seed: number }>,
): Promise<PlayoffSeedRow[]> {
  const rows = await prisma.fantasyStanding.findMany({ where: { leagueId, season } })
  const byRoster = new Map(rows.map((r) => [r.rosterId, r]))
  const out: PlayoffSeedRow[] = []
  for (const s of seeds) {
    const row = byRoster.get(s.rosterId)
    out.push({ rosterId: s.rosterId, seed: s.seed, pointsFor: Number(row?.pointsFor) || 0, wins: row?.wins ?? 0 })
    if (!row) continue
    await prisma.fantasyStanding
      .update({ where: { leagueId_season_rosterId: { leagueId, season, rosterId: s.rosterId } }, data: { playoffSeed: s.seed } })
      .catch(() => {})
  }
  // A team the runtime no longer seeds must not keep a seed from an earlier pass.
  await prisma.fantasyStanding
    .updateMany({ where: { leagueId, season, rosterId: { notIn: seeds.map((s) => s.rosterId) }, playoffSeed: { not: null } }, data: { playoffSeed: null } })
    .catch(() => {})
  return out
}

async function orderStandingsDivisionWinnersFirst(
  leagueId: string,
  season: number,
  standings: Awaited<ReturnType<typeof prisma.fantasyStanding.findMany>>,
) {
  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: { platformUserId: true, divisionId: true },
  })
  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { id: true, platformUserId: true },
  })
  const rosterByPlatform = new Map(rosters.map((r) => [r.platformUserId, r.id]))
  const divisionToRosterIds = new Map<string, string[]>()
  for (const t of teams) {
    if (!t.divisionId) continue
    const rid = rosterByPlatform.get(t.platformUserId ?? '')
    if (!rid) continue
    const list = divisionToRosterIds.get(t.divisionId) ?? []
    list.push(rid)
    divisionToRosterIds.set(t.divisionId, list)
  }

  const byRoster = new Map(standings.map((s) => [s.rosterId, s]))
  const winners: typeof standings = []
  const used = new Set<string>()

  for (const [_div, rids] of divisionToRosterIds) {
    let best: (typeof standings)[number] | null = null
    for (const rid of rids) {
      const row = byRoster.get(rid)
      if (!row) continue
      if (!best || (row.rank ?? 999) < (best.rank ?? 999)) best = row
    }
    if (best) {
      winners.push(best)
      used.add(best.rosterId)
    }
  }

  const rest = standings.filter((s) => !used.has(s.rosterId)).sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
  return [...winners, ...rest]
}
