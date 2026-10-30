import type { HubFormat } from '@/lib/core-app/formatHubs'
import { messagesFor } from '@/lib/i18n/messages'
import { formatHubMessages } from './messages/formatHub'
import { coreLang } from './messages/coreLocale'

/**
 * Spanish for the multi-league format hubs (FormatHub, HubSwitcher) and the connected-franchise
 * scope bar. Every helper returns the English it was given unless `language` is 'es', so the
 * English screens are byte-for-byte unchanged.
 *
 * ⚠ The hubs were English-only end to end. What arrives from the loader — stat labels, a league's
 * status line, trade titles — is still written in English by `lib/core-app/formatHubs.ts` and is not
 * covered here; that needs the loader to take a language.
 */

export const HUB_TABS_ES: Record<HubFormat, string> = {
  zombie: 'Zombie',
  tournament: 'Torneo',
  survivor: 'Survivor',
  c2c: 'C2C',
  guillotine: 'Guilly',
  efl: 'Dinastía EFL',
}

/** Tab names by language; English (and every language without a table) keeps the name it was given. */
const HUB_TABS_BY_LANG: Partial<Record<'en' | 'es', Record<HubFormat, string>>> = { es: HUB_TABS_ES }

export function hubTab(format: HubFormat, english: string, language: string | null | undefined): string {
  return HUB_TABS_BY_LANG[coreLang(language)]?.[format] ?? english
}

/** The themed copy per format, keyed by the English `Theme` field names. */
export type ThemeCopy = {
  title: string
  desc: string
  connect: string
  leaguesLabel: string
  meterLabel: string
  tradesLabel: string
  mentionsLabel: string
  broadcastLabel: string
  emptyTitle: string
  foot: string
}

/** The themed-copy overlay for a language, or null where the English `Theme` stands as written. */
export function themeCopyFor(language: string | null | undefined): ((platformsPhrase: string) => Record<HubFormat, ThemeCopy>) | null {
  return THEME_COPY_BY_LANG[coreLang(language)] ?? null
}

export function themeCopyEs(platformsPhrase: string): Record<HubFormat, ThemeCopy> {
  return {
    zombie: {
      title: 'Centro de ligas Zombie',
      desc: 'Cuando un equipo muere, no deja la liga: vuelve distinto. Cada brote y cada plantilla reanimada en la que juegas, desde un solo centro de mando.',
      connect: '+ Conectar una liga',
      leaguesLabel: 'Ligas infectadas',
      meterLabel: 'Avance de la infección',
      tradesLabel: 'Reportes de mordidas · intercambios',
      mentionsLabel: 'Menciones en todo tu brote',
      broadcastLabel: 'Enviar un mensaje a la horda',
      emptyTitle: 'Todavía no estás en una liga Zombie',
      foot: 'Las infecciones, las reanimaciones y las decisiones del comisionado se registran dentro de cada liga.',
    },
    tournament: {
      title: 'Centro de torneos',
      desc: 'Cada bracket en el que juegas, en un solo centro de mando. Rondas, avances y el camino al trofeo en todas tus ligas de torneo.',
      connect: '+ Conectar ligas importadas',
      leaguesLabel: 'Brackets conectados',
      meterLabel: 'Ronda',
      tradesLabel: 'Intercambios antes del plazo',
      mentionsLabel: 'Menciones en todos tus brackets',
      broadcastLabel: 'Enviar un mensaje a cada bracket',
      emptyTitle: 'No estás en una liga de torneo',
      foot: 'Los avances y los cambios de ronda los registra el torneo al que pertenecen.',
    },
    survivor: {
      title: 'Centro del Consejo Tribal',
      desc: 'Inmunidad, exilio y la traición: cada liga Survivor en la que juegas, desde una sola fogata. La Isla del Exilio te informa directamente.',
      connect: '+ Conectar una tribu',
      leaguesLabel: 'Tus tribus',
      meterLabel: 'Siguen en el juego',
      tradesLabel: 'Alianzas · intercambios',
      mentionsLabel: 'Menciones alrededor de la fogata',
      broadcastLabel: 'Enviar un mensaje a cada tribu',
      emptyTitle: 'Todavía no estás en una liga Survivor',
      foot: 'Los votos, los ídolos y los regresos del exilio se registran dentro de cada liga.',
    },
    c2c: {
      title: 'Centro Campus ⇄ Canton',
      desc: 'Plantillas universitarias y profesionales en una sola dinastía. Cada liga C2C en la que juegas —el peso de campus y canton, la frescura de la sincronización y los intercambios— en un solo lugar.',
      connect: '+ Conectar una liga C2C',
      leaguesLabel: 'Tus ligas C2C',
      meterLabel: 'Frescura de la sincronización',
      tradesLabel: 'Intercambios C2C',
      mentionsLabel: 'Menciones en tus ligas C2C',
      broadcastLabel: 'Enviar un mensaje a cada liga C2C',
      emptyTitle: 'Todavía no estás en una liga C2C',
      foot: `AllFantasy nunca escribe en ${platformsPhrase}: la sincronización solo lee.`,
    },
    guillotine: {
      title: 'Centro de ligas Guilly',
      desc: 'La puntuación más baja de la semana no solo pierde: es ejecutada. Cada liga Guilly en la que juegas, y su corte semanal, desde un solo centro.',
      connect: '+ Conectar una liga',
      leaguesLabel: 'Ligas en el patíbulo',
      meterLabel: 'Equipos que quedan',
      tradesLabel: 'Intercambios en el patíbulo',
      mentionsLabel: 'Menciones en tus ligas',
      broadcastLabel: 'Anunciar el corte semanal',
      emptyTitle: 'Todavía no estás en una liga Guilly',
      foot: 'Cada corte es definitivo y queda registrado, visible para todos los mánagers de la liga donde ocurrió.',
    },
    efl: {
      title: 'Centro Empire Fantasy League',
      desc: 'Cada dinastía que gobiernas, en una sola sala del trono. Clasificación, sucesión y el camino al imperio en cada liga con reglas EFL.',
      connect: '+ Conectar una dinastía',
      leaguesLabel: 'Tus dinastías',
      meterLabel: 'Tu posición',
      tradesLabel: 'Decretos reales · intercambios',
      mentionsLabel: 'Menciones en todo tu imperio',
      broadcastLabel: 'Publicar un decreto real',
      emptyTitle: 'Ninguna de tus ligas usa reglas EFL',
      foot: 'Commissioner OS registra los ascensos, descensos y congelamientos de cada liga.',
    },
  }
}

/** Fixed interface strings on the hub, keyed by their exact English. */
const UI_ES: Record<string, string> = {
  'Core · Format hubs': 'Centros de formatos',
  'Tournament management': 'Gestión de torneos',
  'Connect leagues already imported into AllFantasy. Get manager standings and weekly top scorers across all conferences, then copy or download the Excel report.':
    'Conecta ligas que ya importaste a AllFantasy. Obtén la clasificación de mánagers y los máximos anotadores semanales de todas las conferencias, y luego copia o descarga el informe de Excel.',
  'Connect imported leagues': 'Conectar ligas importadas',
  'Your tournaments and weekly reports': 'Tus torneos e informes semanales',
  'Connect a league': 'Conectar una liga',
  'Bring a league into this hub': 'Trae una liga a este centro',
  Close: 'Cerrar',
  'Already imported?': '¿Ya la importaste?',
  'Select your leagues and group them into a tournament.': 'Elige tus ligas y agrúpalas en un torneo.',
  'Connect leagues': 'Conectar ligas',
  Import: 'Importar',
  Create: 'Crear',
  Percent: 'Porcentaje',
  'Nothing on file yet': 'Todavía no hay nada registrado',
  ' · you commish': ' · eres comisionado',
  Overview: 'Resumen',
  Standings: 'Clasificación',
  Trades: 'Intercambios',
  Draft: 'Draft',
  Commissioner: 'Comisionado',
  'Trade status': 'Estado del intercambio',
  Pending: 'Pendientes',
  Completed: 'Completados',
  Done: 'Hecho',
  'Trades couldn’t be read just now. This is a read failure, not an empty trade log.':
    'No pudimos leer los intercambios en este momento. Es un fallo de lectura, no un historial vacío.',
  'No offers waiting in these leagues.': 'No hay ofertas pendientes en estas ligas.',
  'No completed trades on file for these leagues.': 'No hay intercambios completados registrados en estas ligas.',
  'Mentions couldn’t be read just now.': 'No pudimos leer las menciones en este momento.',
  'Nobody has @-mentioned you in these league chats.': 'Nadie te ha mencionado con @ en los chats de estas ligas.',
  ' Some league data couldn’t be read just now, so this count may be low.':
    ' No pudimos leer algunos datos de las ligas en este momento, así que este número puede quedarse corto.',
  ' Some figures couldn’t be read just now and may be low.':
    ' No pudimos leer algunas cifras en este momento y pueden quedarse cortas.',
  'Commissioner hub →': 'Centro del comisionado →',
  'Portfolio →': 'Portafolio →',
  'Commissioner hubs': 'Centros del comisionado',
  'All leagues': 'Todas las ligas',
  // Connected-franchise scope bar
  'CONNECTED FRANCHISE': 'FRANQUICIA CONECTADA',
  'Use this tool in a connected league': 'Usa esta herramienta en una liga conectada',
  'Ask Chimmy across all': 'Preguntar a Chimmy en todas',
  'Hub home': 'Inicio del centro',
}

const UI_BY_LANG: Partial<Record<'en' | 'es', Record<string, string>>> = { es: UI_ES }

export function hubCopy(english: string, language: string | null | undefined): string {
  return UI_BY_LANG[coreLang(language)]?.[english] ?? english
}

/** Sentences with a value in them — the words live in lib/core-app/messages/formatHub.ts. */
const hub = (language: string | null | undefined) => messagesFor(formatHubMessages, language)

export const hubText = {
  connectBody(tab: string, canCreate: boolean, language: string | null | undefined): string {
    return hub(language).connectBody(tab, canCreate)
  },
  importFrom(platforms: string, language: string | null | undefined): string {
    return hub(language).importFrom(platforms)
  },
  appearsWhen(tab: string, language: string | null | undefined): string {
    return hub(language).appearsWhen(tab)
  },
  startOn(tab: string, language: string | null | undefined): string {
    return hub(language).startOn(tab)
  },
  pickFormat(tab: string, language: string | null | undefined): string {
    return hub(language).pickFormat(tab)
  },
  atAGlance(tab: string, language: string | null | undefined): string {
    return hub(language).atAGlance(tab)
  },
  across(n: number, language: string | null | undefined): string {
    return hub(language).across(n)
  },
  leaguesYouPlay(tab: string, language: string | null | undefined): string {
    return hub(language).leaguesYouPlay(tab)
  },
  comparison(tab: string, language: string | null | undefined): string {
    return hub(language).comparison(tab)
  },
  leagueTools(name: string, language: string | null | undefined): string {
    return hub(language).leagueTools(name)
  },
  showing(shown: number, total: number, language: string | null | undefined): string {
    return hub(language).showing(shown, total)
  },
  fillsIn(tab: string, language: string | null | undefined): string {
    return hub(language).fillsIn(tab)
  },
  scopeAria(franchise: string, language: string | null | undefined): string {
    return hub(language).scopeAria(franchise)
  },
  askAllPrefill(franchise: string, decision: string, language: string | null | undefined): string {
    return hub(language).askAllPrefill(franchise, decision)
  },
}

const THEME_COPY_BY_LANG: Partial<Record<'en' | 'es', (platformsPhrase: string) => Record<HubFormat, ThemeCopy>>> = { es: themeCopyEs }
