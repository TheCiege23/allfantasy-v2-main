import type { HubFormat } from '@/lib/core-app/formatHubs'

/**
 * Spanish for the multi-league format hubs (FormatHub, HubSwitcher) and the connected-franchise
 * scope bar. Every helper returns the English it was given unless `language` is 'es', so the
 * English screens are byte-for-byte unchanged.
 *
 * ⚠ The hubs were English-only end to end. What arrives from the loader — stat labels, a league's
 * status line, trade titles — is still written in English by `lib/core-app/formatHubs.ts` and is not
 * covered here; that needs the loader to take a language.
 */

const es = (language: string | null | undefined) => language === 'es'

export const HUB_TABS_ES: Record<HubFormat, string> = {
  zombie: 'Zombie',
  tournament: 'Torneo',
  survivor: 'Survivor',
  c2c: 'C2C',
  guillotine: 'Guillotina',
  efl: 'Dinastía EFL',
}

export function hubTab(format: HubFormat, english: string, language: string | null | undefined): string {
  return es(language) ? HUB_TABS_ES[format] : english
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
      title: 'Centro de ligas Guillotina',
      desc: 'La puntuación más baja de la semana no solo pierde: es ejecutada. Cada liga guillotina en la que juegas, y su corte semanal, desde un solo centro.',
      connect: '+ Conectar una liga',
      leaguesLabel: 'Ligas en el patíbulo',
      meterLabel: 'Equipos que quedan',
      tradesLabel: 'Intercambios en el patíbulo',
      mentionsLabel: 'Menciones en tus ligas',
      broadcastLabel: 'Anunciar el corte semanal',
      emptyTitle: 'Todavía no estás en una liga guillotina',
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

export function hubCopy(english: string, language: string | null | undefined): string {
  return es(language) ? (UI_ES[english] ?? english) : english
}

/** Sentences with a value in them. */
export const hubText = {
  connectBody(tab: string, canCreate: boolean, language: string | null | undefined): string {
    return es(language)
      ? `Este centro reúne cada liga ${tab} en la que ya estás. Para agregar una, impórtala desde la plataforma donde está${canCreate ? ', o crea una nueva en AllFantasy' : ''}. Nada cambia en la plataforma original.`
      : `This hub gathers every ${tab} league you’re already in. To add one, import it from the platform it lives on${canCreate ? ', or start a new one on AllFantasy' : ''}. Nothing changes on the original platform.`
  },
  importFrom(platforms: string, language: string | null | undefined): string {
    return es(language) ? `Importar desde ${platforms}` : `Import from ${platforms}`
  },
  appearsWhen(tab: string, language: string | null | undefined): string {
    return es(language)
      ? `Aparece aquí en cuanto se reconoce como una liga ${tab}.`
      : `It appears here as soon as it is recognised as a ${tab} league.`
  },
  startOn(tab: string, language: string | null | undefined): string {
    return es(language) ? `Crear una liga ${tab} en AllFantasy` : `Start a ${tab} league on AllFantasy`
  },
  pickFormat(tab: string, language: string | null | undefined): string {
    return es(language) ? `Elige el formato ${tab} al crear la liga.` : `Pick the ${tab} format in league creation.`
  },
  atAGlance(tab: string, language: string | null | undefined): string {
    return es(language) ? `${tab} de un vistazo` : `${tab} at a glance`
  },
  across(n: number, language: string | null | undefined): string {
    return es(language) ? `En tus ${n} ${n === 1 ? 'liga' : 'ligas'}` : `Across your ${n} ${n === 1 ? 'league' : 'leagues'}`
  },
  leaguesYouPlay(tab: string, language: string | null | undefined): string {
    return es(language) ? `Ligas ${tab} en las que juegas` : `${tab} leagues you play in`
  },
  comparison(tab: string, language: string | null | undefined): string {
    return es(language) ? `Comparación de ligas ${tab}` : `${tab} league comparison`
  },
  leagueTools(name: string, language: string | null | undefined): string {
    return es(language) ? `Herramientas de ${name}` : `${name} tools`
  },
  showing(shown: number, total: number, language: string | null | undefined): string {
    return es(language)
      ? `Se muestran ${shown} de ${total}. Todas las ligas están en `
      : `Showing ${shown} of ${total}. Every league is in `
  },
  fillsIn(tab: string, language: string | null | undefined): string {
    return es(language)
      ? `Este centro se completa solo en cuanto una de tus ligas sea una liga ${tab}, importada o creada.`
      : `This hub fills in by itself the moment one of your leagues is a ${tab} league — imported or created.`
  },
  scopeAria(franchise: string, language: string | null | undefined): string {
    return es(language) ? `Alcance de la herramienta: ${franchise}` : `${franchise} tool scope`
  },
  askAllPrefill(franchise: string, decision: string, language: string | null | undefined): string {
    return es(language)
      ? `Usa cada plantilla seleccionada de ${franchise} para ayudarme con esta decisión (${decision}).`
      : `Use every selected roster in ${franchise} to help with this ${decision} decision.`
  },
}
