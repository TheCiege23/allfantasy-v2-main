import 'server-only'

/**
 * The dynasty rollover wizard's league read (./dynastyRolloverWizard.ts) for the Commissioner Hub,
 * and its one write of its own: next season's dues.
 *
 * Everything else the wizard leads to is an action that already exists, and the card calls it
 * where it lives: creating the rookie draft (`create_next_draft` on the draft controls) and starting
 * the season (POST /api/leagues/[id]/season/start-new). Head commissioner only, as the redraft
 * wizard is. Native dynasty-family leagues only. All Postgres.
 */
import { prisma } from '@/lib/prisma'
import { hasAfCommissionerPlan } from '@/lib/entitlements/afCommissionerPlan'
import { readBracketResult } from '@/lib/redraft/offseason/RedraftOffseasonService'
import { rookieDraftState } from '@/lib/redraft/offseason/startDynastyNewSeason'
import {
  DYNASTY_ROLLOVER_METADATA_KEY,
  previewDynastyRolloverHousekeeping,
  type HousekeepingMove,
  type RolloverHousekeepingResult,
} from '@/lib/redraft/offseason/dynastyRolloverHousekeeping'
import { readLiveRookieOrderSettings } from '@/lib/rookie-order/liveRookieOrderService'
import { readDuesTracker } from '@/lib/core-app/commissioner/health'
import { readTaxiMaxYears } from '@/lib/taxi/taxiMaxYears'
import { readPayoutsView } from '@/lib/payouts/payoutService'
import { readPayoutPlan } from '@/lib/payouts/payoutCalculator'
import { executeLeagueSettingsPatch } from '@/lib/league/execute-league-settings-patch'
import {
  buildDynastyRolloverAnnouncement,
  buildDynastyRolloverPlan,
  type DynastyRolloverInput,
  type DynastyRolloverPlan,
  type RookieOrderSource,
} from './dynastyRolloverWizard'

export type DynastyRolloverView = {
  applies: true
  kind: 'dynasty'
  leagueName: string
  season: number
  nextSeason: number
  /** From the playoffs until next season's first week. */
  show: boolean
  input: DynastyRolloverInput
  plan: DynastyRolloverPlan
  extras: {
    announcement: { en: string; es: string }
    payoutCarry: { fromCents: number | null; toCents: number } | null
  } | null
}

const CONTRACT_LIVE = ['active', 'tagged', 'option_exercised']

type SeasonRow = { id: string; season: number; status: string; createdAt: Date; currentWeek: number; playoffStartWeek: number; totalWeeks: number }

/**
 * Which season is being rolled out of, which one comes next, and whether it has begun. Null for a
 * league with no completed season (the first season is built by its startup draft).
 */
export function resolveDynastyRolloverSeasons(seasons: readonly SeasonRow[]): {
  outgoing: SeasonRow
  incoming: SeasonRow | null
  seasonOver: boolean
  started: boolean
  inPlayoffs: boolean
} | null {
  const [latest, prev] = seasons
  if (!latest) return null
  if (latest.status === 'complete') return { outgoing: latest, incoming: null, seasonOver: true, started: false, inPlayoffs: false }
  if (prev?.status === 'complete') {
    if (latest.status === 'setup') return { outgoing: prev, incoming: latest, seasonOver: true, started: false, inPlayoffs: false }
    // Next season is being played: the card stays up through its first week, then steps aside.
    if (latest.currentWeek <= 1) return { outgoing: prev, incoming: latest, seasonOver: true, started: true, inPlayoffs: false }
  }
  if (latest.status === 'setup') return null
  const inPlayoffs = latest.playoffStartWeek > 0 && latest.currentWeek >= latest.playoffStartWeek
  return { outgoing: latest, incoming: null, seasonOver: false, started: false, inPlayoffs }
}

const isTaxiMove = (m: Pick<HousekeepingMove, 'reason'>) => m.reason !== 'ir_ineligible_status'

export async function readDynastyRolloverView(
  leagueId: string,
  userId: string,
): Promise<DynastyRolloverView | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      name: true, settings: true, lifecycleMetadata: true,
      taxiSlots: true, taxiAllowNonRookies: true, taxiYearsLimit: true,
      teams: { select: { id: true } },
    },
  })
  if (!league) return null
  const seasons = await prisma.redraftSeason.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    take: 2,
    select: { id: true, season: true, status: true, createdAt: true, currentWeek: true, playoffStartWeek: true, totalWeeks: true },
  })
  const where = resolveDynastyRolloverSeasons(seasons)
  if (!where) return null
  const { outgoing, incoming, seasonOver, started, inPlayoffs } = where
  const settings = (league.settings as Record<string, unknown> | null) ?? {}

  const [bracket, rookieDraft, dynastyConfig, capConfig, matchups, payouts, entitled] = await Promise.all([
    prisma.redraftPlayoffBracket.findUnique({ where: { seasonId: outgoing.id }, select: { structure: true } }),
    incoming ? rookieDraftState(leagueId, incoming) : Promise.resolve('none' as const),
    prisma.dynastyLeagueConfig.findUnique({ where: { leagueId }, select: { rookiePickOrderMethod: true } }).catch(() => null),
    prisma.salaryCapLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } }).catch(() => null),
    incoming ? prisma.redraftMatchup.count({ where: { seasonId: incoming.id } }) : Promise.resolve(0),
    readPayoutsView(leagueId, userId),
    prisma.appUser.findUnique({ where: { id: userId }, select: { id: true, email: true, username: true } }).then(hasAfCommissionerPlan),
  ])

  const bracketResult = readBracketResult(bracket?.structure ?? null)
  const champion = bracketResult
    ? await prisma.redraftRoster
        .findUnique({ where: { id: bracketResult.championRosterId }, select: { teamName: true, ownerName: true } })
        .then((r) => r?.teamName?.trim() || r?.ownerName || null)
    : null

  // Same precedence the rookie draft seats by (lib/live-draft-engine/createNextLeagueDraft.ts).
  const live = readLiveRookieOrderSettings(league.settings)
  const finalOrderSaved = Boolean(live.finalOrder && live.finalOrder.basedOnSeason === outgoing.season)
  const method = dynastyConfig?.rookiePickOrderMethod ?? 'max_pf'
  const source: RookieOrderSource =
    method === 'weighted_lottery'
      ? 'lottery'
      : live.enabled && finalOrderSaved
        ? 'live_order'
        : method === 'commissioner'
          ? 'commissioner'
          : method === 'reverse_standings'
            ? 'standings'
            : 'max_pf'

  // Taxi: what the start will move, or — once it has run — what it moved.
  let toBench = 0
  let unverified = 0
  let overLimitTeams = 0
  const stored = (league.lifecycleMetadata as Record<string, unknown> | null)?.[DYNASTY_ROLLOVER_METADATA_KEY] as
    | RolloverHousekeepingResult
    | undefined
  if (started && incoming && stored?.seasonId === incoming.id) {
    toBench = (stored.movedToBench ?? []).filter(isTaxiMove).length
    unverified = stored.taxiUnverified ?? 0
    overLimitTeams = stored.needsCutDown?.length ?? 0
  } else if (seasonOver && !started) {
    const preview = await previewDynastyRolloverHousekeeping(leagueId, (incoming ?? outgoing).id).catch(() => null)
    if (preview) {
      toBench = preview.moves.filter(isTaxiMove).length
      unverified = preview.taxiUnverified
      overLimitTeams = preview.needsCutDown.length
    }
  }

  let contracts: DynastyRolloverInput['contracts'] = null
  if (capConfig) {
    const rows = await prisma.playerContract.findMany({
      where: { configId: capConfig.id, status: { in: CONTRACT_LIVE } },
      select: { yearSigned: true, yearsTotal: true },
    })
    contracts = { active: rows.length, expiring: rows.filter((c) => c.yearSigned + c.yearsTotal - 1 <= outgoing.season).length }
  }

  const dues = readDuesTracker(settings)
  const rawDues = settings.dues_tracker as { season?: unknown } | undefined
  const paidTeams = dues?.entries.filter((e) => e.paid).length ?? 0
  const nextSeason = incoming?.season ?? outgoing.season + 1
  const setForNextSeason = rawDues?.season === nextSeason
  const duesAmount = dues?.amount != null && dues.amount > 0 ? dues.amount : null

  const input: DynastyRolloverInput = {
    season: outgoing.season,
    nextSeason,
    seasonOver,
    started,
    champion,
    rookieDraft,
    draftOrder: { source, finalOrderSaved },
    taxi: {
      slots: league.taxiSlots ?? 0,
      yearsLimit: league.taxiYearsLimit ?? null,
      allowNonRookies: Boolean(league.taxiAllowNonRookies),
      maxSeasons: readTaxiMaxYears(league.settings),
      toBench,
      unverified,
    },
    contracts,
    dues: {
      enabled: Boolean(dues?.enabled),
      amountDollars: duesAmount,
      unpaidTeams: dues?.enabled && !setForNextSeason ? Math.max(0, league.teams.length - paidTeams) : 0,
      setForNextSeason,
    },
    schedule: { matchups, weeks: incoming?.totalWeeks ?? 0 },
    overLimitTeams,
  }

  const pv = payouts.ok && payouts.native ? payouts : null
  const places = pv?.result
    ? pv.result.places.map((p) => ({ place: p.place, cents: p.cents, team: p.rosterId ? pv.result!.names[p.rosterId] ?? null : null }))
    : []
  const payoutPlan = readPayoutPlan(settings)
  const toCents = setForNextSeason && duesAmount != null ? Math.round(duesAmount * 100) : null
  const announcementInput = {
    leagueName: league.name ?? 'Our league',
    season: outgoing.season,
    nextSeason,
    champion,
    places,
    duesDollars: setForNextSeason ? duesAmount : null,
    orderSource: source,
    rookieDraft,
    taxiToBench: started ? 0 : toBench,
  }

  return {
    applies: true,
    kind: 'dynasty',
    leagueName: league.name ?? '',
    season: outgoing.season,
    nextSeason,
    show: (seasonOver && !started) || inPlayoffs || started,
    input,
    plan: buildDynastyRolloverPlan(input),
    extras: entitled
      ? {
          announcement: {
            en: buildDynastyRolloverAnnouncement({ ...announcementInput, language: 'en' }),
            es: buildDynastyRolloverAnnouncement({ ...announcementInput, language: 'es' }),
          },
          payoutCarry:
            payoutPlan.placePercents.length && toCents != null && toCents !== payoutPlan.buyInCents
              ? { fromCents: payoutPlan.buyInCents, toCents }
              : null,
        }
      : null,
  }
}

export type SetDuesResult = { ok: true; response: Response } | { ok: false; status: 400; error: string }

/**
 * Next season's dues: a fresh list, nobody marked paid, stamped with the season it is for. Free,
 * as the redraft renew's dues are. Through the settings patch, so the lock and audit apply.
 * Only between the seasons — a list cleared mid-season would lose who has paid.
 */
export async function setDynastyNextSeasonDues(
  leagueId: string,
  userId: string,
  view: DynastyRolloverView,
  amountDollars: number | null,
): Promise<SetDuesResult> {
  if (!view.input.seasonOver || view.input.started) {
    return { ok: false, status: 400, error: 'Next season’s dues are set between the seasons.' }
  }
  if (amountDollars != null && (!Number.isFinite(amountDollars) || amountDollars < 0 || amountDollars > 100_000)) {
    return { ok: false, status: 400, error: 'Enter dues between $0 and $100,000.' }
  }
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const current = ((league?.settings as Record<string, unknown> | null)?.dues_tracker ?? {}) as Record<string, unknown>
  const amount = amountDollars && amountDollars > 0 ? Math.round(amountDollars * 100) / 100 : null
  const response = await executeLeagueSettingsPatch(userId, {
    leagueId,
    settingsMerge: {
      dues_tracker: { ...current, enabled: amount != null, amount, entries: [], season: view.nextSeason },
    },
  })
  return { ok: true, response }
}

/** For the Commissioner Workspace (no viewer): the season is over and next season has not started. */
export async function readDynastyRolloverDue(leagueId: string): Promise<{ season: number } | null> {
  const seasons = await prisma.redraftSeason.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    take: 2,
    select: { id: true, season: true, status: true, createdAt: true, currentWeek: true, playoffStartWeek: true, totalWeeks: true },
  })
  const where = resolveDynastyRolloverSeasons(seasons)
  return where && where.seasonOver && !where.started ? { season: where.outgoing.season } : null
}
