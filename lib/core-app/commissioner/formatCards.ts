import type { CommissionerLeagueProfile } from '@/lib/commissioner-os/profile/types'

export type CommissionerFormatCard = { key: string; title: string; detail: string; href: string; action: string }

/** Cards describe verified league mechanics; links lead to the existing operator surface. */
export function commissionerFormatCards(profile: CommissionerLeagueProfile, rawLeagueType?: string | null): CommissionerFormatCard[] {
  const id = encodeURIComponent(profile.leagueId)
  const league = `/league/${id}`
  const capabilities = new Set(profile.capabilityIds)
  const cards: CommissionerFormatCard[] = []
  const add = (key: string, title: string, detail: string, view: string, action: string) =>
    cards.push({ key, title, detail, href: `${league}?view=${view}`, action })

  if (capabilities.has('roster.keeper_carryover')) add('keeper', 'Keeper decisions', 'Review retained players, costs and the next draft.', 'keeper', 'Open keepers')
  if (capabilities.has('elimination.guillotine')) add('guillotine', 'Elimination week', 'Review cuts, released rosters and waiver timing.', 'guillotine', 'Open guillotine')
  if (capabilities.has('survivor.tribes')) add('survivor', 'Survivor command', 'Review tribes, challenges, tribal votes and phase state.', 'survivor_command', 'Open command')
  if (profile.canonicalFormatId === 'big_brother' || profile.conceptId === 'big_brother') add('big_brother', 'Big Brother command', 'Review HOH, veto, eviction and jury state.', 'bb_command', 'Open command')
  if (profile.canonicalFormatId === 'zombie' || profile.conceptId === 'zombie') add('zombie', 'Zombie control', 'Review conversions and survival status.', 'zombie', 'Open zombie')
  if (capabilities.has('standings.promotion_relegation')) add('efl', 'Promotion and relegation', 'Review tier movement, frozen standings inputs and rookie order.', 'standings', 'Open standings')
  if (profile.canonicalFormatId === 'devy') add('devy', 'Devy assets', 'Review college rights, taxi decisions and rookie picks.', 'dynasty_picks', 'Open picks')
  if (profile.canonicalFormatId === 'c2c') add('c2c', 'Campus to Canton', 'Review college and pro assets, transitions and picks.', 'dynasty_picks', 'Open picks')
  if (capabilities.has('advancement.tournament')) add('tournament', 'Tournament advancement', 'Review brackets and progression rules.', 'standings', 'Open standings')
  if (/^four[_ -]?horsemen$/i.test(rawLeagueType?.trim() ?? '') || /four[_ -]?horsemen/i.test(profile.conceptId ?? '') || /four[_ -]?horsemen/i.test(profile.aliasTags.join(' '))) {
    add('four_horsemen', 'Four Horsemen rules', 'Review the configured rules before making a commissioner ruling.', 'settings', 'Open settings')
  }
  return cards
}
