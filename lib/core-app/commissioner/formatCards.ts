import type { CommissionerLeagueProfile } from '@/lib/commissioner-os/profile/types'
import { messagesFor } from '@/lib/i18n/messages'
import { leagueSettingsHomeHref } from '@/lib/league-settings-home/settingsEntryRouting'
import { commissionerBuildersMessages } from '../messages/commissionerBuilders'

export type CommissionerFormatCardFact = { key: string; label: string; value: string }
export type CommissionerFormatCardLink = { key: string; label: string; href: string }

export type CommissionerFormatCard = {
  key: string
  title: string
  detail: string
  href: string
  action: string
  /** Only the dynasty card carries these: one row per saved setting, and the settings page for each. */
  facts?: CommissionerFormatCardFact[]
  links?: CommissionerFormatCardLink[]
  /** Rookie draft rounds, drawn as pick chips. Absent when the league has no saved round count. */
  rookieRounds?: number
  picksLabel?: string
  tone?: 'dynasty'
}

/**
 * A dynasty league's saved settings, read by the hub (commissionerHub.ts). Every field is null when
 * nothing was saved for it — the card then leaves that row out rather than showing a default.
 */
export type DynastyFormatFacts = {
  rosterSize: number | null
  taxiSlots: number | null
  devySlots: number | null
  rookieDraftRounds: number | null
  rookieDraftType: string | null
  futurePicksYearsOut: number | null
  /** From the league's own season rows; null for an imported league or one with no season yet. */
  rollover: { state: 'due' | 'started' | 'in_season'; season: number } | null
}

const positive = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

/** The dynasty card: the league's real roster, taxi, devy, rookie draft, pick-trading and rollover settings. */
export function dynastyFormatCard(leagueId: string, facts: DynastyFormatFacts, language = 'en'): CommissionerFormatCard {
  const m = messagesFor(commissionerBuildersMessages, language)
  const rows: CommissionerFormatCardFact[] = []
  const links: CommissionerFormatCardLink[] = []
  const link = (key: string, label: string, href: string) => {
    if (!links.some((l) => l.key === key)) links.push({ key, label, href })
  }

  if (positive(facts.rosterSize)) rows.push({ key: 'roster', label: m.formatDynastyRosterLabel, value: m.formatDynastyRosterValue(facts.rosterSize) })
  if (positive(facts.taxiSlots)) rows.push({ key: 'taxi', label: m.formatDynastyTaxiLabel, value: m.formatDynastySlotsValue(facts.taxiSlots) })
  if (positive(facts.devySlots)) rows.push({ key: 'devy', label: m.formatDynastyDevyLabel, value: m.formatDynastySlotsValue(facts.devySlots) })
  if (rows.length) link('roster', m.formatDynastyLinkRoster, leagueSettingsHomeHref(leagueId, 'roster'))

  const type = String(facts.rookieDraftType ?? '').toLowerCase()
  const knownType = type === 'linear' || type === 'snake' ? type : null
  const rounds = positive(facts.rookieDraftRounds) ? Math.round(facts.rookieDraftRounds) : null
  if (rounds) {
    rows.push({ key: 'rookie', label: m.formatDynastyRookieLabel, value: m.formatDynastyRookieValue(rounds, knownType) })
    link('draft', m.formatDynastyLinkDraft, leagueSettingsHomeHref(leagueId, 'draft'))
  }
  if (positive(facts.futurePicksYearsOut)) {
    rows.push({ key: 'pick_years', label: m.formatDynastyPickYearsLabel, value: m.formatDynastyPickYearsValue(facts.futurePicksYearsOut) })
    link('trades', m.formatDynastyLinkTrades, leagueSettingsHomeHref(leagueId, 'trades'))
  }
  if (facts.rollover) {
    const { state, season } = facts.rollover
    const value =
      state === 'due' ? m.formatDynastyRolloverDue(season) : state === 'started' ? m.formatDynastyRolloverStarted(season) : m.formatDynastyRolloverInSeason(season)
    rows.push({ key: 'rollover', label: m.formatDynastyRolloverLabel, value })
    // The wizard is on this page only while there is a rollover to run.
    if (state === 'due') link('rollover', m.formatDynastyLinkRollover, '#ch-rollover')
  }

  return {
    key: 'dynasty',
    title: m.formatDynastyTitle,
    detail: rows.length ? m.formatDynastyDetail : m.formatDynastyEmpty,
    href: leagueSettingsHomeHref(leagueId, 'format'),
    action: m.formatDynastyAction,
    facts: rows,
    links,
    ...(rounds ? { rookieRounds: rounds, picksLabel: m.formatDynastyPicksAria(rounds) } : {}),
    tone: 'dynasty',
  }
}

/** Cards describe verified league mechanics; links lead to the existing operator surface. */
export function commissionerFormatCards(
  profile: CommissionerLeagueProfile,
  rawLeagueType?: string | null,
  language = 'en',
  /** Passed only for a dynasty league (usesDynastyBackground); every other league renders as before. */
  dynasty?: DynastyFormatFacts | null,
): CommissionerFormatCard[] {
  const m = messagesFor(commissionerBuildersMessages, language)
  const id = encodeURIComponent(profile.leagueId)
  const league = `/league/${id}`
  const capabilities = new Set(profile.capabilityIds)
  const cards: CommissionerFormatCard[] = []
  const add = (key: string, title: string, detail: string, view: string, action: string) =>
    cards.push({ key, title, detail, href: `${league}?view=${view}`, action })

  if (dynasty) cards.push(dynastyFormatCard(profile.leagueId, dynasty, language))
  if (capabilities.has('roster.keeper_carryover')) add('keeper', m.formatKeeperTitle, m.formatKeeperDetail, 'keeper', m.formatKeeperAction)
  if (capabilities.has('elimination.guillotine')) add('guillotine', m.formatGuillotineTitle, m.formatGuillotineDetail, 'guillotine', m.formatGuillotineAction)
  if (capabilities.has('survivor.tribes')) add('survivor', m.formatSurvivorTitle, m.formatSurvivorDetail, 'survivor_command', m.formatOpenCommand)
  if (profile.canonicalFormatId === 'big_brother' || profile.conceptId === 'big_brother') add('big_brother', m.formatBigBrotherTitle, m.formatBigBrotherDetail, 'bb_command', m.formatOpenCommand)
  if (profile.canonicalFormatId === 'zombie' || profile.conceptId === 'zombie') add('zombie', m.formatZombieTitle, m.formatZombieDetail, 'zombie', m.formatZombieAction)
  if (capabilities.has('standings.promotion_relegation')) add('efl', m.formatEflTitle, m.formatEflDetail, 'standings', m.formatOpenStandings)
  if (profile.canonicalFormatId === 'devy') add('devy', m.formatDevyTitle, m.formatDevyDetail, 'dynasty_picks', m.formatOpenPicks)
  if (profile.canonicalFormatId === 'c2c') add('c2c', m.formatC2cTitle, m.formatC2cDetail, 'dynasty_picks', m.formatOpenPicks)
  if (capabilities.has('advancement.tournament')) add('tournament', m.formatTournamentTitle, m.formatTournamentDetail, 'standings', m.formatOpenStandings)
  if (/^four[_ -]?horsemen$/i.test(rawLeagueType?.trim() ?? '') || /four[_ -]?horsemen/i.test(profile.conceptId ?? '') || /four[_ -]?horsemen/i.test(profile.aliasTags.join(' '))) {
    add('four_horsemen', m.formatFourHorsemenTitle, m.formatFourHorsemenDetail, 'settings', m.formatFourHorsemenAction)
  }
  return cards
}
