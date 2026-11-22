import 'server-only'

/**
 * The season rollover wizard's league read (./rolloverWizard.ts) for the Commissioner Hub, and its
 * one AF Commissioner write: carrying next season's dues into the payout buy-in.
 *
 * Head commissioner only, as the renew it leads to is (app/api/commissioner/leagues/[id]/renew).
 * Native leagues only. A dynasty league carries its rosters, so it gets its own steps
 * (./dynastyRolloverService.ts) on the same card and route; a tournament feeder renews from its
 * hub, an imported league renews on its platform. All Postgres.
 */
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import { isAlreadyRenewedIntoSeason, isSeasonOverForRenewal, renewalKindFromSelection, resolveLeagueVariantKey } from '@/lib/leagues/renewalPolicy'
import { readBracketResult } from '@/lib/redraft/offseason/RedraftOffseasonService'
import { resolveRenewDraftOrderMode, type RenewDraftOrderMode } from '@/lib/redraft/offseason/renewRedraftLeague'
import { readDuesTracker } from '@/lib/core-app/commissioner/health'
import { readPayoutsView } from '@/lib/payouts/payoutService'
import { PAYOUT_PLAN_KEY, readPayoutPlan } from '@/lib/payouts/payoutCalculator'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import { buildRolloverAnnouncement, buildRolloverPlan, type RolloverInput, type RolloverPlan } from './rolloverWizard'
import { readDynastyRolloverDue, readDynastyRolloverView, setDynastyNextSeasonDues, type DynastyRolloverView } from './dynastyRolloverService'

export type RolloverView = {
  applies: true
  kind: 'redraft'
  leagueName: string
  season: number
  nextSeason: number
  /** The final weeks or later: the Hub shows the wizard from the playoffs on. */
  show: boolean
  input: RolloverInput
  plan: RolloverPlan
  /** AF Commissioner extras; null without the plan. */
  extras: {
    announcement: { en: string; es: string }
    /** Next season's dues differ from the payout buy-in, so they can be carried over. */
    payoutCarry: { fromCents: number | null; toCents: number } | null
  } | null
}

export type RolloverReadResult =
  | { ok: true; view: RolloverView | DynastyRolloverView | { applies: false; reason: 'not_native' | 'not_redraft' | 'no_season' } }
  | { ok: false; status: 401 | 403 | 404 }

async function loadPlanFlag(userId: string): Promise<boolean> {
  const user = await prisma.appUser.findUnique({ where: { id: userId }, select: { id: true, email: true, username: true } })
  return hasAfCommissionerPlan(user)
}

export async function readRolloverView(leagueId: string, userId: string | null | undefined): Promise<RolloverReadResult> {
  if (!userId) return { ok: false, status: 401 }
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      userId: true, name: true, season: true, status: true, settings: true, platform: true,
      leagueVariant: true, isDynasty: true, lifecycleState: true, lifecycleMetadata: true,
      teams: { select: { teamName: true, ownerName: true, isOrphan: true } },
    },
  })
  if (!league) return { ok: false, status: 404 }
  if (league.userId !== userId) return { ok: false, status: 403 }
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') return { ok: true, view: { applies: false, reason: 'not_native' } }
  const settings = (league.settings as Record<string, unknown> | null) ?? {}
  const kind = renewalKindFromSelection({
    leagueVariant: league.leagueVariant,
    settings,
    selectedType: resolveLeagueVariantKey(league.leagueVariant, settings),
    isDynasty: league.isDynasty,
  })
  if (kind === 'dynasty_family') {
    const dynasty = await readDynastyRolloverView(leagueId, userId)
    return { ok: true, view: dynasty ?? { applies: false, reason: 'no_season' } }
  }
  if (kind !== 'redraft_reset') return { ok: true, view: { applies: false, reason: 'not_redraft' } }

  const season = league.season ?? new Date().getFullYear()
  const redraftSeason = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { season: 'desc' },
    select: { id: true, season: true, currentWeek: true, playoffStartWeek: true },
  })
  const [bracket, payouts, leagueSettings, pendingTrades, pendingClaims, entitled] = await Promise.all([
    redraftSeason
      ? prisma.redraftPlayoffBracket.findUnique({ where: { seasonId: redraftSeason.id }, select: { structure: true } })
      : Promise.resolve(null),
    readPayoutsView(leagueId, userId),
    prisma.leagueSettings.findUnique({ where: { leagueId }, select: { draftOrderMethod: true } }),
    prisma.redraftTradeProposal.count({ where: { leagueId, status: 'pending' } }),
    prisma.redraftWaiverClaim.count({ where: { leagueId, status: 'pending' } }),
    loadPlanFlag(userId),
  ])

  const bracketResult = readBracketResult(bracket?.structure ?? null)
  const champion = bracketResult
    ? await prisma.redraftRoster
        .findUnique({ where: { id: bracketResult.championRosterId }, select: { teamName: true, ownerName: true } })
        .then((r) => r?.teamName?.trim() || r?.ownerName || null)
    : null

  const isOrphan = (t: { ownerName: string | null; isOrphan: boolean }) => t.isOrphan || !t.ownerName || t.ownerName.startsWith('orphan-')
  const orphanTeams = league.teams.filter(isOrphan).map((t) => t.teamName?.trim() || 'A team')
  const dues = readDuesTracker(settings)
  const rawDues = settings.dues_tracker as { amount?: unknown } | undefined
  const duesAmount = typeof rawDues?.amount === 'number' && rawDues.amount > 0 ? rawDues.amount : null
  const paidTeams = dues?.entries.filter((e) => e.paid).length ?? 0

  const pv = payouts.ok && payouts.native ? payouts : null
  const places = pv?.result
    ? pv.result.places.map((p) => ({ place: p.place, cents: p.cents, team: p.rosterId ? pv.result!.names[p.rosterId] ?? null : null }))
    : []
  const draftOrder: RenewDraftOrderMode = resolveRenewDraftOrderMode(leagueSettings?.draftOrderMethod ?? null) ?? 'standings'
  const seasonOver = isSeasonOverForRenewal({
    status: league.status,
    dynastySeasonPhase: settings.dynastySeasonPhase as string | undefined,
    seasonPhase: settings.season_phase as string | undefined,
    lifecycleState: league.lifecycleState,
  })
  const renewed = isAlreadyRenewedIntoSeason({ season, status: league.status, settings, lifecycleMetadata: league.lifecycleMetadata })

  const input: RolloverInput = {
    season,
    nextSeason: season + 1,
    seasonOver,
    renewed,
    champion,
    payouts: { configured: Boolean(pv?.plan.placePercents.length), final: Boolean(pv?.result?.final), places },
    managers: { active: league.teams.length - orphanTeams.length, orphanTeams },
    dues: { enabled: Boolean(dues?.enabled), amountDollars: duesAmount, unpaidTeams: dues?.enabled ? Math.max(0, league.teams.length - paidTeams) : 0 },
    draftOrder,
    pendingTrades,
    pendingClaims,
  }
  const inPlayoffs = Boolean(redraftSeason && redraftSeason.playoffStartWeek > 0 && redraftSeason.currentWeek >= redraftSeason.playoffStartWeek)

  const plan = readPayoutPlan(settings)
  const toCents = duesAmount != null ? Math.round(duesAmount * 100) : null
  const announcementInput = {
    leagueName: league.name ?? 'Our league',
    season: renewed ? season - 1 : season,
    nextSeason: renewed ? season : season + 1,
    champion,
    places,
    duesDollars: duesAmount,
    draftOrder,
  }

  return {
    ok: true,
    view: {
      applies: true,
      kind: 'redraft',
      leagueName: league.name ?? '',
      season,
      nextSeason: season + 1,
      show: seasonOver || renewed || inPlayoffs,
      input,
      plan: buildRolloverPlan(input),
      extras: entitled
        ? {
            announcement: {
              en: buildRolloverAnnouncement({ ...announcementInput, language: 'en' }),
              es: buildRolloverAnnouncement({ ...announcementInput, language: 'es' }),
            },
            payoutCarry: plan.placePercents.length && toCents != null && toCents !== plan.buyInCents ? { fromCents: plan.buyInCents, toCents } : null,
          }
        : null,
    },
  }
}

export type CarryResult = { ok: true; response: Response } | { ok: false; status: 400 | 401 | 402 | 403 | 404; error: string }

/**
 * AF Commissioner: make next season's dues the payout calculator's buy-in, keeping the place split.
 * Through the settings patch, so the settings lock and audit apply as to any payout edit.
 */
export async function carryDuesIntoPayouts(leagueId: string, userId: string | null | undefined): Promise<CarryResult> {
  const read = await readRolloverView(leagueId, userId)
  if (!read.ok) return { ok: false, status: read.status, error: read.status === 404 ? 'Not found' : 'Forbidden' }
  if (!read.view.applies) return { ok: false, status: 400, error: 'This league does not use the rollover wizard.' }
  if (!read.view.extras) return { ok: false, status: 402, error: 'Carrying dues into payouts is part of AF Commissioner.' }
  const carry = read.view.extras.payoutCarry
  if (!carry) return { ok: false, status: 400, error: 'There is nothing to carry: set a place split and next season’s dues first.' }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const plan = readPayoutPlan(league?.settings)
  const response = await executeLeagueSettingsPatch(userId!, {
    leagueId,
    settingsMerge: { [PAYOUT_PLAN_KEY]: { ...plan, buyInCents: carry.toCents } },
  })
  return { ok: true, response }
}

/**
 * For the Commissioner Workspace (no viewer): the season of a native league is over and it has not
 * been renewed (redraft) or next season has not started (dynasty). Null otherwise. A failed read
 * throws, so the task store never closes a task on a snapshot it could not take.
 */
export async function readRolloverDue(leagueId: string): Promise<{ season: number; kind: 'redraft' | 'dynasty' } | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { season: true, status: true, settings: true, platform: true, leagueVariant: true, isDynasty: true, lifecycleState: true, lifecycleMetadata: true },
  })
  if (!league || resolveWriteAuthority(league.platform) !== 'NATIVE') return null
  const settings = (league.settings as Record<string, unknown> | null) ?? {}
  const kind = renewalKindFromSelection({
    leagueVariant: league.leagueVariant,
    settings,
    selectedType: resolveLeagueVariantKey(league.leagueVariant, settings),
    isDynasty: league.isDynasty,
  })
  if (kind === 'dynasty_family') {
    const due = await readDynastyRolloverDue(leagueId)
    return due ? { ...due, kind: 'dynasty' } : null
  }
  if (kind !== 'redraft_reset') return null
  const season = league.season ?? new Date().getFullYear()
  const over = isSeasonOverForRenewal({
    status: league.status,
    dynastySeasonPhase: settings.dynastySeasonPhase as string | undefined,
    seasonPhase: settings.season_phase as string | undefined,
    lifecycleState: league.lifecycleState,
  })
  if (!over) return null
  if (isAlreadyRenewedIntoSeason({ season, status: league.status, settings, lifecycleMetadata: league.lifecycleMetadata })) return null
  return { season, kind: 'redraft' }
}

/** The dynasty card's dues step. Head commissioner, between the seasons. */
export async function setNextSeasonDues(
  leagueId: string,
  userId: string | null | undefined,
  amountDollars: number | null,
): Promise<CarryResult> {
  const read = await readRolloverView(leagueId, userId)
  if (!read.ok) return { ok: false, status: read.status, error: read.status === 404 ? 'Not found' : 'Forbidden' }
  if (!read.view.applies || read.view.kind !== 'dynasty') return { ok: false, status: 400, error: 'This league sets next season’s dues when it renews.' }
  return setDynastyNextSeasonDues(leagueId, userId!, read.view, amountDollars)
}
