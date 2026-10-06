import type { CommissionerLeagueProfile } from '@/lib/commissioner-os/profile/types'
import { pickLanguage } from './pickLanguage'

export type CommissionerFormatCard = { key: string; title: string; detail: string; href: string; action: string }

/** Cards describe verified league mechanics; links lead to the existing operator surface. */
export function commissionerFormatCards(
  profile: CommissionerLeagueProfile,
  rawLeagueType?: string | null,
  language = 'en',
): CommissionerFormatCard[] {
  const L = pickLanguage(language)
  const id = encodeURIComponent(profile.leagueId)
  const league = `/league/${id}`
  const capabilities = new Set(profile.capabilityIds)
  const cards: CommissionerFormatCard[] = []
  const add = (key: string, title: string, detail: string, view: string, action: string) =>
    cards.push({ key, title, detail, href: `${league}?view=${view}`, action })

  if (capabilities.has('roster.keeper_carryover')) add('keeper', L('Keeper decisions', 'Decisiones de keepers'), L('Review retained players, costs and the next draft.', 'Revisa los jugadores retenidos, sus costes y el próximo draft.'), 'keeper', L('Open keepers', 'Abrir keepers'))
  if (capabilities.has('elimination.guillotine')) add('guillotine', L('Elimination week', 'Semana de eliminación'), L('Review cuts, released rosters and waiver timing.', 'Revisa los cortes, las plantillas liberadas y los plazos de agentes libres.'), 'guillotine', L('Open guillotine', 'Abrir guillotina'))
  if (capabilities.has('survivor.tribes')) add('survivor', L('Survivor command', 'Mando de Survivor'), L('Review tribes, challenges, tribal votes and phase state.', 'Revisa las tribus, los desafíos, las votaciones tribales y el estado de cada fase.'), 'survivor_command', L('Open command', 'Abrir el mando'))
  if (profile.canonicalFormatId === 'big_brother' || profile.conceptId === 'big_brother') add('big_brother', L('Big Brother command', 'Mando de Big Brother'), L('Review HOH, veto, eviction and jury state.', 'Revisa el HOH, el veto, la expulsión y el estado del jurado.'), 'bb_command', L('Open command', 'Abrir el mando'))
  if (profile.canonicalFormatId === 'zombie' || profile.conceptId === 'zombie') add('zombie', L('Zombie control', 'Control de zombis'), L('Review conversions and survival status.', 'Revisa las conversiones y el estado de supervivencia.'), 'zombie', L('Open zombie', 'Abrir zombis'))
  if (capabilities.has('standings.promotion_relegation')) add('efl', L('Promotion and relegation', 'Ascensos y descensos'), L('Review tier movement, frozen standings inputs and rookie order.', 'Revisa los cambios de división, los datos de clasificación congelados y el orden de novatos.'), 'standings', L('Open standings', 'Abrir la clasificación'))
  if (profile.canonicalFormatId === 'devy') add('devy', L('Devy assets', 'Activos devy'), L('Review college rights, taxi decisions and rookie picks.', 'Revisa los derechos universitarios, las decisiones de taxi y las selecciones de novatos.'), 'dynasty_picks', L('Open picks', 'Abrir selecciones'))
  if (profile.canonicalFormatId === 'c2c') add('c2c', L('Campus to Canton', 'Campus to Canton'), L('Review college and pro assets, transitions and picks.', 'Revisa los activos universitarios y profesionales, las transiciones y las selecciones.'), 'dynasty_picks', L('Open picks', 'Abrir selecciones'))
  if (capabilities.has('advancement.tournament')) add('tournament', L('Tournament advancement', 'Avance del torneo'), L('Review brackets and progression rules.', 'Revisa los cuadros y las reglas de avance.'), 'standings', L('Open standings', 'Abrir la clasificación'))
  if (/^four[_ -]?horsemen$/i.test(rawLeagueType?.trim() ?? '') || /four[_ -]?horsemen/i.test(profile.conceptId ?? '') || /four[_ -]?horsemen/i.test(profile.aliasTags.join(' '))) {
    add('four_horsemen', L('Four Horsemen rules', 'Reglas de Four Horsemen'), L('Review the configured rules before making a commissioner ruling.', 'Revisa las reglas configuradas antes de tomar una decisión como comisionado.'), 'settings', L('Open settings', 'Abrir la configuración'))
  }
  return cards
}
