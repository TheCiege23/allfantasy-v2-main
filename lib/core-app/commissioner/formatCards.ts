import type { CommissionerLeagueProfile } from '@/lib/commissioner-os/profile/types'
import { messagesFor } from '@/lib/i18n/messages'
import { commissionerBuildersMessages } from '../messages/commissionerBuilders'

export type CommissionerFormatCard = { key: string; title: string; detail: string; href: string; action: string }

/** Cards describe verified league mechanics; links lead to the existing operator surface. */
export function commissionerFormatCards(
  profile: CommissionerLeagueProfile,
  rawLeagueType?: string | null,
  language = 'en',
): CommissionerFormatCard[] {
  const m = messagesFor(commissionerBuildersMessages, language)
  const id = encodeURIComponent(profile.leagueId)
  const league = `/league/${id}`
  const capabilities = new Set(profile.capabilityIds)
  const cards: CommissionerFormatCard[] = []
  const add = (key: string, title: string, detail: string, view: string, action: string) =>
    cards.push({ key, title, detail, href: `${league}?view=${view}`, action })

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
