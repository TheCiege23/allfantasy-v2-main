import 'server-only'

/**
 * The payout calculator's league view (./payoutCalculator.ts). Every member sees the pot, the place
 * split and what each team stands to collect; a commissioner also sees how much of the buy-in has
 * been collected and gets the plan to edit. All Postgres; nothing is written on a read.
 */
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { getLeagueRole } from '@/lib/league/permissions'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { extractEntryFeeUsdFromSettings } from '@/lib/league-finance/extractEntryFeeFromSettings'
import { CONTEST_KINDS, readSideContests } from '@/lib/side-contests/sideContests'
import { readSideContestsView } from '@/lib/side-contests/sideContestsService'
import { calculatePayouts, readPayoutPlan, suggestedPlacePercents, type PayoutPlan, type PayoutResult, type PlaceRow } from './payoutCalculator'

export type PayoutsView = {
  /** False outside leagues AllFantasy runs itself: there are no standings or prizes to read. */
  native: boolean
  canEdit: boolean
  plan: PayoutPlan
  /** The league's entry fee, the buy-in when the plan names none. */
  entryFeeCents: number
  suggestedPercents: number[]
  season: number | null
  teamCount: number
  result: (PayoutResult & { names: Record<string, string> }) | null
  /** Commissioners only: buy-ins marked paid this season. */
  collected: { cents: number; paidTeams: number } | null
}

export type PayoutsReadResult = ({ ok: true } & PayoutsView) | { ok: false; status: 401 | 403 | 404 }

/** The final finishing order a completed season stored, or null while it is still being played. */
export function readFinalOrder(input: {
  bracket: { status: string; structure: unknown } | null
  settings: unknown
  season: number
}): PlaceRow[] | null {
  if (input.bracket?.status === 'complete') {
    const s = input.bracket.structure as { finalStandings?: Array<{ finish?: unknown; rosterId?: unknown }> } | null
    const rows = (s?.finalStandings ?? [])
      .filter((r) => typeof r.rosterId === 'string' && typeof r.finish === 'number')
      .map((r) => ({ rosterId: r.rosterId as string, place: r.finish as number }))
    if (rows.length) return rows
  }
  // Rotisserie leagues have no bracket; finalizeRotoSeason stores the order in settings.
  const roto = (input.settings as Record<string, unknown> | null)?.roto_season_results as Record<string, unknown> | undefined
  const entry = roto?.[String(input.season)] as { finalStandings?: Array<{ rosterId?: unknown; rank?: unknown }> } | undefined
  const rows = (entry?.finalStandings ?? [])
    .filter((r) => typeof r.rosterId === 'string' && typeof r.rank === 'number')
    .map((r) => ({ rosterId: r.rosterId as string, place: r.rank as number }))
  return rows.length ? rows : null
}

/** The current standings order (`RedraftRoster.playoffSeed`, which the standings engine keeps). */
export function currentOrder(rosters: ReadonlyArray<{ id: string; playoffSeed: number | null }>): PlaceRow[] {
  return rosters
    .filter((r): r is { id: string; playoffSeed: number } => typeof r.playoffSeed === 'number' && r.playoffSeed > 0)
    .sort((a, b) => a.playoffSeed - b.playoffSeed)
    .map((r, i) => ({ rosterId: r.id, place: i + 1 }))
}

export async function readPayoutsView(leagueId: string, userId: string | null | undefined): Promise<PayoutsReadResult> {
  const membership = await resolveLeagueMembership(leagueId, userId)
  if (!membership.ok) return { ok: false, status: membership.status as 401 | 403 | 404 }
  const role = await getLeagueRole(leagueId, userId!)
  const canEdit = role === 'commissioner' || role === 'co_commissioner'

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, settings: true } })
  if (!league) return { ok: false, status: 404 }
  const plan = readPayoutPlan(league.settings)
  const finance = await prisma.leagueFinance.findUnique({ where: { leagueId }, select: { entryFeeCents: true } })
  const feeUsd = extractEntryFeeUsdFromSettings(league.settings)
  const entryFeeCents = finance?.entryFeeCents || (feeUsd != null ? Math.round(feeUsd * 100) : 0)
  const empty: PayoutsView = {
    native: false,
    canEdit,
    plan,
    entryFeeCents,
    suggestedPercents: [],
    season: null,
    teamCount: 0,
    result: null,
    collected: null,
  }
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return { ok: true, ...empty }

  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { season: 'desc' },
    select: { id: true, season: true, playoffStartWeek: true, totalWeeks: true },
  })
  if (!season) return { ok: true, ...empty, native: true }

  const [rosters, bracket, sides, dues] = await Promise.all([
    prisma.redraftRoster.findMany({ where: { seasonId: season.id }, select: { id: true, teamName: true, ownerName: true, playoffSeed: true } }),
    prisma.redraftPlayoffBracket.findUnique({ where: { seasonId: season.id }, select: { status: true, structure: true } }),
    readSideContestsView(leagueId, userId),
    canEdit
      ? prisma.leagueDues.findMany({ where: { leagueId, season: season.season }, select: { amountPaidCents: true, status: true } })
      : Promise.resolve(null),
  ])

  const config = readSideContests(league.settings)
  const weeklyPrizeCentsPerWeek = CONTEST_KINDS.reduce((sum, k) => sum + (config[k].enabled ? config[k].prizeCents : 0), 0)
  const regularSeasonWeeks = season.playoffStartWeek > 1 ? season.playoffStartWeek - 1 : season.totalWeeks
  const finalOrder = readFinalOrder({ bracket, settings: league.settings, season: season.season })
  const result = calculatePayouts({
    plan,
    entryFeeCents,
    teamCount: rosters.length,
    weeklyPrizeCentsPerWeek,
    regularSeasonWeeks,
    weeklyPrizesWon: sides.ok ? sides.totals : [],
    order: finalOrder ?? currentOrder(rosters),
    final: finalOrder !== null,
  })
  const names = Object.fromEntries(rosters.map((r) => [r.id, r.teamName?.trim() || r.ownerName || 'Team']))

  return {
    ok: true,
    native: true,
    canEdit,
    plan,
    entryFeeCents,
    suggestedPercents: suggestedPlacePercents(rosters.length),
    season: season.season,
    teamCount: rosters.length,
    result: { ...result, names },
    collected: dues
      ? {
          cents: dues.reduce((sum, d) => sum + (d.amountPaidCents ?? 0), 0),
          paidTeams: dues.filter((d) => d.status === 'paid').length,
        }
      : null,
  }
}

/**
 * For the Commissioner Workspace (no viewer): whether the weekly prizes promise more than the pot
 * holds, in a league whose commissioner has set a place split. Null when that does not apply. A
 * failed read throws, so the task store never closes a task on a snapshot it could not take.
 */
export async function readPayoutOvercommitment(leagueId: string): Promise<{ potCents: number; overCommittedCents: number; season: number } | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, settings: true } })
  if (!league || resolveWriteAuthority(league.platform) !== 'NATIVE') return null
  const plan = readPayoutPlan(league.settings)
  if (plan.placePercents.length === 0) return null
  const config = readSideContests(league.settings)
  const perWeek = CONTEST_KINDS.reduce((sum, k) => sum + (config[k].enabled ? config[k].prizeCents : 0), 0)
  if (perWeek === 0) return null
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { season: 'desc' },
    select: { id: true, season: true, playoffStartWeek: true, totalWeeks: true },
  })
  if (!season) return null
  const [finance, teamCount] = await Promise.all([
    prisma.leagueFinance.findUnique({ where: { leagueId }, select: { entryFeeCents: true } }),
    prisma.redraftRoster.count({ where: { seasonId: season.id } }),
  ])
  const feeUsd = extractEntryFeeUsdFromSettings(league.settings)
  const result = calculatePayouts({
    plan,
    entryFeeCents: finance?.entryFeeCents || (feeUsd != null ? Math.round(feeUsd * 100) : 0),
    teamCount,
    weeklyPrizeCentsPerWeek: perWeek,
    regularSeasonWeeks: season.playoffStartWeek > 1 ? season.playoffStartWeek - 1 : season.totalWeeks,
    weeklyPrizesWon: [],
    order: [],
    final: false,
  })
  return { potCents: result.potCents, overCommittedCents: result.overCommittedCents, season: season.season }
}
