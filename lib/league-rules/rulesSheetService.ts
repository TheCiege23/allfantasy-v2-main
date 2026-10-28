/**
 * Reads a league for the rules sheet (./rulesSheet.ts) and builds it in the viewer's language.
 *
 * ⚠ EVERY VALUE COMES FROM THE READER THE LEAGUE'S OWN ENGINE USES — trades from
 * `resolveLeagueTradeSettings`, waivers from `getEffectiveLeagueWaiverSettings`, playoff size from
 * `readPlayoffFormat`, the start week from `resolvePlayoffStartWeek`, starters from
 * `resolveLineupStarterSlots`, the format from `resolveLeagueRules`. A second reading of the raw
 * columns here is how the sheet would come to describe a rule the league does not play.
 *
 * An imported league's rules live on its platform: only the format, scoring, starters and playoff
 * size are read (the readers above that understand an import), and the sheet says where the rest is.
 */
import 'server-only'

import { prisma } from '@/lib/prisma'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { isNativePlatform } from '@/lib/league/isNativeLeague'
import { resolveLeagueRules } from './resolveLeagueRules'
import { buildRulesSheet, platformName, rulesT, type RuleSection, type RulesSheetInput } from './rulesSheet'
import { isDynastyFamilyLeague } from '@/lib/redraft/offseason/dynastyFamily'
import { resolveLeagueTradeSettings } from '@/lib/league-trade-engine/tradeSettingsResolver'
import { readDeadlineAt } from '@/lib/trade-deadline/tradeDeadlineTime'
import { pickTradeDeadlineFor } from '@/lib/trade-deadline/pickTradeDeadline'
import { readPickTermsEnabled } from '@/lib/league-trade-engine/pickTerms'
import { getEffectiveLeagueWaiverSettings } from '@/lib/waiver-wire/settings-service'
import { normalizeWaiverTypeForEngine } from '@/lib/waiver-wire/waiver-engine-config'
import { readPlayoffFormat } from '@/lib/core-app/outlookFormat'
import { readChosenPlayoffStartWeek, resolvePlayoffStartWeek } from '@/lib/playoff-settings/resolvePlayoffStartWeek'
import { readStoredThirdPlaceGame, readThirdPlaceGameEnabled } from '@/lib/playoff-runtime/thirdPlaceGame'
import { readTiebreakerOrder, TIEBREAKER_LABELS, TIEBREAKER_KEYS, type TiebreakerKey } from '@/lib/standings/tiebreakerOrder'
import { readMedianGameInPlayoffs } from '@/lib/redraft/medianGame'
import { readLineupMode, supportsDailyLineups } from '@/lib/redraft/lineupModeSwitch'
import { readTaxiStealingRule } from '@/lib/taxi/taxiStealing'
import { getGuillotineConfig } from '@/lib/guillotine/GuillotineLeagueConfig'
import { readAdvanced } from '@/lib/guillotine/chopSchedule'
import { getRosterTemplateForLeague } from '@/lib/multi-sport/MultiSportRosterService'
import { getFormatTypeForVariant } from '@/lib/sport-defaults/LeagueVariantRegistry'
import { resolveLineupStarterSlots } from '@/lib/league/lineupStarterSlots'
import { getStarterSlotLabels } from '@/lib/league/rosterSlots'

export type RulesSheetLang = 'en' | 'es'

export type RulesSheetView = {
  leagueId: string
  leagueName: string | null
  sport: string
  native: boolean
  /** The host platform's name, for an imported league. */
  platform: string | null
  sections: RuleSection[]
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** Sleeper-shaped settings nest the provider's league under a key; read through it like the rules card does. */
function providerBundle(settings: unknown): Record<string, unknown> {
  const s = asObject(settings) ?? {}
  const nested = asObject(s.sleeper) ?? asObject(s.sleeperLeague) ?? asObject(s.league)
  return nested ? { ...s, ...nested } : s
}

export async function readRulesSheet(
  leagueId: string,
  userId: string,
  lang: RulesSheetLang,
): Promise<{ ok: true; view: RulesSheetView } | { ok: false; status: 403 | 404 }> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, include: { leagueSettings: true } })
  if (!league) return { ok: false, status: 404 }
  if (!(await canAccessLeagueDraft(leagueId, userId))) return { ok: false, status: 403 }

  const native = isNativePlatform(league.platform)
  const sport = String(league.sport ?? 'NFL')
  const teamCount = league.leagueSize ?? (await prisma.roster.count({ where: { leagueId } }))
  const resolved = resolveLeagueRules({ ...league, sport })
  const dynastyFamily = isDynastyFamilyLeague(league)
  const t = rulesT(lang)

  const playoffFormat = readPlayoffFormat(league.settings, Math.max(2, teamCount), native ? league.playoffTeams : null)
  const tiebreakers = readTiebreakerOrder(league.settings)
  const tiebreakerLabels = Object.fromEntries(TIEBREAKER_KEYS.map((k) => [k, TIEBREAKER_LABELS[k][lang]])) as Record<TiebreakerKey, string>
  const start = native ? resolvePlayoffStartWeek({ ...league, sport }) : null
  const importedStart = native ? null : readChosenPlayoffStartWeek({ settings: league.settings })

  let starterSlots: string[] = []
  if (native) {
    const template = await getRosterTemplateForLeague(sport as never, getFormatTypeForVariant(sport, league.leagueVariant ?? undefined), league.id).catch(() => null)
    starterSlots = resolveLineupStarterSlots(league as never, template).map((s) => s.label)
  } else {
    const positions = providerBundle(league.settings).roster_positions
    starterSlots = Array.isArray(positions) ? getStarterSlotLabels(positions.map(String)) : []
  }

  const input: RulesSheetInput = {
    native,
    platform: native ? null : league.platform,
    sport,
    teamCount,
    concept: resolved.concept?.id ?? null,
    conceptLabel: resolved.concept?.label ?? null,
    dynastyFamily,
    scoring: league.scoring,
    medianGame: native ? league.medianGame === true : null,
    medianInPlayoffs: readMedianGameInPlayoffs(league.settings),
    starterSlots,
    rosterSize: native ? league.rosterSize : null,
    irSlots: native ? league.irSlots : null,
    lineupMode: native && supportsDailyLineups(sport) ? readLineupMode(league.settings, sport) : null,
    waivers: null,
    trades: null,
    draft: null,
    playoffs: {
      teams: playoffFormat.playoffTeams,
      teamsSource: playoffFormat.playoffTeamsSource === 'league' ? 'league' : 'default',
      byes: playoffFormat.byeTeams,
      startWeek: start?.week ?? importedStart,
      startSource: start ? (start.source === 'sport_default' ? 'default' : 'league') : importedStart != null ? 'league' : null,
      thirdPlace: native
        ? readStoredThirdPlaceGame(league.settings) ?? readThirdPlaceGameEnabled(league.settings, sport, league.leagueVariant)
        : null,
      tiebreakers,
      tiebreakerLabels,
    },
    keeper:
      resolved.formatRules.concept === 'keeper'
        ? { count: resolved.keeper.maxKeepers, cost: resolved.keeper.costSystem, maxYears: native ? league.keeperMaxYears : null }
        : null,
    taxi: null,
    guillotine: null,
    lang,
  }

  if (native) {
    const trade = resolveLeagueTradeSettings(league)
    input.trades = {
      allowed: trade.tradesAllowed,
      reviewMode: trade.tradeReviewMode,
      reviewHours: trade.tradeReviewHours,
      vetoPercent: trade.vetoThresholdPercent,
      deadlineWeek: trade.tradeDeadlineWeek != null && trade.tradeDeadlineWeek > 0 ? trade.tradeDeadlineWeek : null,
      deadlineAt: readDeadlineAt(league.settings)?.toISOString() ?? null,
      timezone: league.timezone,
      pickTrading: trade.draftPickTradingAllowed,
      pickDeadline: dynastyFamily ? pickTradeDeadlineFor(league) : null,
      pickTerms: dynastyFamily ? readPickTermsEnabled(league.settings) : null,
    }

    const waivers = await getEffectiveLeagueWaiverSettings(leagueId).catch(() => null)
    if (waivers) {
      input.waivers = { type: normalizeWaiverTypeForEngine(waivers.normalizedWaiverType ?? waivers.waiverType), faabBudget: waivers.faabBudget ?? league.waiverBudget }
    }

    const ds = league.leagueSettings
    if (ds) {
      input.draft = {
        type: ds.draftType,
        rounds: ds.rounds,
        timerPreset: ds.pickTimerPreset,
        timerCustomSeconds: ds.pickTimerCustomValue,
        orderMethod: ds.draftOrderMethod,
        playerPool: ds.playerPool,
      }
    }

    if (dynastyFamily) {
      input.taxi = {
        slots: league.taxiSlots ?? 0,
        yearsLimit: league.taxiYearsLimit,
        nonRookies: league.taxiAllowNonRookies === true,
        deadlineWeek: league.taxiDeadlineWeek,
        stealing: readTaxiStealingRule(league.settings),
      }
    }

    const g = await getGuillotineConfig(leagueId).catch(() => null)
    if (g) {
      input.guillotine = {
        teamsPerChop: g.teamsPerChop,
        startWeek: g.eliminationStartWeek,
        endWeek: g.eliminationEndWeek,
        advanced: readAdvanced(league.settings),
        tiebreakers: g.tiebreakerOrder,
        release: g.rosterReleaseTiming,
      }
    }
  }

  return {
    ok: true,
    view: {
      leagueId,
      leagueName: league.name,
      sport,
      native,
      platform: native ? null : platformName(league.platform, t('rules.format.platform.other')),
      sections: buildRulesSheet(input, t),
    },
  }
}
