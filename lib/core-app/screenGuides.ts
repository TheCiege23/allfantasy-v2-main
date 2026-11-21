/**
 * "What's this page?" — one plain explanation per /core screen (2026-11-20).
 *
 * The owner's report: the core site is confusing, and people need more explanation of what they can
 * do and what everything does. The help topics in lib/core-app/help-topics/ explain single TERMS
 * (a tooltip on "FAAB", on a meter); nothing explained a whole SCREEN. This does, in three parts:
 *
 *   what  — one sentence: what the page is for.
 *   can   — up to three things you can do here, each starting with a verb.
 *   start — the one thing to do first if you are new to the page.
 *
 * Read by components/core-app/ScreenGuide.tsx (the strip at the top of each screen) and
 * components/core-app/HowItWorks.tsx (every page in one list).
 *
 * ⚠ KEYED ON THE URL SEGMENT, NOT THE NAV KEY. /core/schedule and /core/moves light the `home` nav
 * item (the page's SCREEN_TO_NAV map), so a guide keyed on the nav key would describe the league
 * overview while the reader is looking at the schedule.
 *
 * ⚠ DESCRIBE WHAT THE SCREEN DOES, NOT WHAT IT MIGHT. Every line here was checked against the
 * screen's own header comment. Imported leagues are read-only: say "open it on your platform",
 * never "make the move here", unless the screen really writes.
 *
 * ⚠ SPANISH FOLLOWS THE APP'S WORDING RULINGS (__tests__/spanish-wording-rulings.test.tsx): the
 * Waivers screen and its players are «agentes libres», a claim is «reclamo», and no Spanish value
 * says «waiver». Chimmy is named; nothing says "AI" (memory: no-ai-wording-say-chimmy).
 */

export type ScreenGuideKey =
  | 'home'
  | 'overview'
  | 'my-team'
  | 'matchup'
  | 'trades'
  | 'waivers'
  | 'players'
  | 'week'
  | 'live'
  | 'standings'
  | 'schedule'
  | 'moves'
  | 'season-outlook'
  | 'war-room'
  | 'draft-hq'
  | 'my-leagues'
  | 'portfolio'
  | 'career'
  | 'rankings'
  | 'tools'
  | 'notifications'
  | 'league-settings'
  | 'devy'
  | 'devy-league'
  | 'defense-hub'
  | 'commissioner'

export type ScreenGuide = {
  /** The page's name as the nav shows it. */
  name: string
  what: string
  can: string[]
  start: string
}

type Lang = 'en' | 'es'

const GUIDES: Record<ScreenGuideKey, Record<Lang, ScreenGuide>> = {
  home: {
    en: {
      name: 'Home',
      what: 'Everything that needs you today, across all your leagues, in one list.',
      can: [
        'See which lineups, trades and drafts need you first',
        'Jump straight into the league that needs the most attention',
        'Ask Chimmy to compare priorities across every league',
      ],
      start: 'Work the list from the top — the most urgent thing is always first.',
    },
    es: {
      name: 'Inicio',
      what: 'Todo lo que te necesita hoy, en todas tus ligas, en una sola lista.',
      can: [
        'Ve qué alineaciones, intercambios y drafts te necesitan primero',
        'Entra directo a la liga que más atención necesita',
        'Pídele a Chimmy que compare prioridades entre todas tus ligas',
      ],
      start: 'Recorre la lista desde arriba: lo más urgente siempre va primero.',
    },
  },
  overview: {
    en: {
      name: 'Overview',
      what: 'One league at a glance: your team, this week’s game and what to do next.',
      can: [
        'See your record, this week’s opponent and open tasks',
        'Open your team, matchup, trades or free agents from here',
        'Ask Chimmy about this league — it knows its rules and rosters',
      ],
      start: 'Check the “to do” items first, then open My team.',
    },
    es: {
      name: 'Resumen',
      what: 'Una liga de un vistazo: tu equipo, el partido de esta semana y qué hacer después.',
      can: [
        'Ve tu récord, el rival de esta semana y las tareas pendientes',
        'Abre desde aquí tu equipo, el enfrentamiento, intercambios o agentes libres',
        'Pregúntale a Chimmy por esta liga: conoce sus reglas y plantillas',
      ],
      start: 'Revisa primero las tareas pendientes y luego abre Mi equipo.',
    },
  },
  'my-team': {
    en: {
      name: 'My team',
      what: 'Your roster in this league, with who should start and who is hurt.',
      can: [
        'Spot starters who are out, on bye or doubtful',
        'See who on your bench should start instead',
        'Open any player for news, value and outlook',
      ],
      start: 'Fix anything marked red before your league’s lineup lock.',
    },
    es: {
      name: 'Mi equipo',
      what: 'Tu plantilla en esta liga: quién debe jugar y quién está lesionado.',
      can: [
        'Detecta titulares fuera, en descanso o en duda',
        'Ve quién de tu banca debería jugar en su lugar',
        'Abre cualquier jugador para ver noticias, valor y pronóstico',
      ],
      start: 'Corrige todo lo marcado en rojo antes del cierre de alineación.',
    },
  },
  matchup: {
    en: {
      name: 'Matchup',
      what: 'This week’s game: your lineup against your opponent’s, slot by slot.',
      can: [
        'Compare each starter with the player they face',
        'See which players still have games left to play',
        'Find the positions most likely to decide the week',
      ],
      start: 'Look for the slots where your opponent is much stronger.',
    },
    es: {
      name: 'Enfrentamiento',
      what: 'El partido de esta semana: tu alineación contra la de tu rival, posición por posición.',
      can: [
        'Compara cada titular con el jugador al que enfrenta',
        'Ve qué jugadores aún tienen partidos por jugar',
        'Encuentra las posiciones que más pueden decidir la semana',
      ],
      start: 'Busca las posiciones donde tu rival es mucho más fuerte.',
    },
  },
  trades: {
    en: {
      name: 'Trades',
      what: 'Build, check and review trades for this league.',
      can: [
        'Build a trade and see if it is fair for both sides',
        'Review offers and trades other managers made',
        'Get trade ideas that fill a hole on your roster',
      ],
      start: 'Add the players you would give and get to see the value balance.',
    },
    es: {
      name: 'Intercambios',
      what: 'Arma, revisa y analiza intercambios para esta liga.',
      can: [
        'Arma un intercambio y ve si es justo para ambos',
        'Revisa ofertas e intercambios de otros mánagers',
        'Recibe ideas de intercambio que cubran un hueco de tu plantilla',
      ],
      start: 'Agrega los jugadores que darías y recibirías para ver el balance de valor.',
    },
  },
  waivers: {
    en: {
      name: 'Waivers',
      what: 'Free agents worth adding in this league, and what to bid.',
      can: [
        'See the best available players for your weak spots',
        'Get a suggested bid that fits your remaining budget',
        'Check your claim order and when claims run',
      ],
      start: 'Start with the top target, then place the claim on your platform.',
    },
    es: {
      name: 'Agentes libres',
      what: 'Agentes libres que vale la pena sumar en esta liga, y cuánto ofrecer.',
      can: [
        'Ve los mejores jugadores disponibles para tus puntos débiles',
        'Recibe una oferta sugerida que encaje con tu presupuesto',
        'Revisa tu prioridad de reclamo y cuándo se procesan los reclamos',
      ],
      start: 'Empieza por el primer objetivo y haz el reclamo en tu plataforma.',
    },
  },
  players: {
    en: {
      name: 'Player Finder',
      what: 'Search any player and see where they fit in your leagues.',
      can: [
        'Find who owns a player in each of your leagues',
        'See value, trend and depth-chart role',
        'Follow a player to get news about them',
      ],
      start: 'Type a name in the search box.',
    },
    es: {
      name: 'Buscador de jugadores',
      what: 'Busca cualquier jugador y ve cómo encaja en tus ligas.',
      can: [
        'Encuentra quién tiene a un jugador en cada una de tus ligas',
        'Ve su valor, tendencia y rol en la profundidad',
        'Sigue a un jugador para recibir sus noticias',
      ],
      start: 'Escribe un nombre en el buscador.',
    },
  },
  week: {
    en: {
      name: 'Your week',
      what: 'A day-by-day plan for the week: what to do, and when.',
      can: [
        'See today’s job — waivers early in the week, lineups before games',
        'Tick off each league as it is done',
        'Check rivalries and the games that matter most',
      ],
      start: 'Do today’s step, then come back tomorrow.',
    },
    es: {
      name: 'Tu semana',
      what: 'Un plan día a día para la semana: qué hacer y cuándo.',
      can: [
        'Ve la tarea de hoy: agentes libres al inicio, alineaciones antes de los partidos',
        'Marca cada liga cuando esté lista',
        'Revisa rivalidades y los partidos que más importan',
      ],
      start: 'Haz el paso de hoy y vuelve mañana.',
    },
  },
  live: {
    en: {
      name: 'Live scores',
      what: 'Real games happening now, with your players marked.',
      can: [
        'Follow scores for every game on the slate',
        'See which of your players are playing right now',
        'Open a game for the play-by-play',
      ],
      start: 'Look for games with your players highlighted.',
    },
    es: {
      name: 'En vivo',
      what: 'Los partidos reales en curso, con tus jugadores marcados.',
      can: [
        'Sigue el marcador de cada partido de la jornada',
        'Ve cuáles de tus jugadores están jugando ahora',
        'Abre un partido para ver jugada a jugada',
      ],
      start: 'Busca los partidos con tus jugadores resaltados.',
    },
  },
  standings: {
    en: {
      name: 'Standings',
      what: 'The league table, plus a power ranking based on how teams actually score.',
      can: [
        'See who is in playoff position and how far you are from it',
        'Compare the official table with the power ranking',
        'Check points for, points against and tiebreaks',
      ],
      start: 'Find your row, then look at the playoff line.',
    },
    es: {
      name: 'Clasificación',
      what: 'La tabla de la liga y un ranking de poder según cuánto anota cada equipo.',
      can: [
        'Ve quién está en zona de playoffs y a cuánto estás',
        'Compara la tabla oficial con el ranking de poder',
        'Revisa puntos a favor, en contra y desempates',
      ],
      start: 'Busca tu fila y luego mira la línea de playoffs.',
    },
  },
  schedule: {
    en: {
      name: 'Schedule',
      what: 'This week’s game and what comes next in the season.',
      can: [
        'See who you play this week and later on',
        'Check upcoming deadlines and season phases',
        'Look back at past weeks’ scores',
      ],
      start: 'Read the top line — it says where the season stands.',
    },
    es: {
      name: 'Calendario',
      what: 'El partido de esta semana y lo que viene en la temporada.',
      can: [
        'Ve contra quién juegas esta semana y después',
        'Revisa los próximos plazos y fases de la temporada',
        'Mira los marcadores de semanas pasadas',
      ],
      start: 'Lee la primera línea: dice en qué punto está la temporada.',
    },
  },
  moves: {
    en: {
      name: 'Moves',
      what: 'Every add, drop and trade in this league, newest first.',
      can: [
        'See what other managers picked up or dropped',
        'Review trades and how they changed each roster',
        'Spot managers who are active — and who are not',
      ],
      start: 'Scan the newest moves for players you wanted.',
    },
    es: {
      name: 'Movimientos',
      what: 'Cada alta, baja e intercambio de esta liga, del más nuevo al más viejo.',
      can: [
        'Ve qué sumaron o soltaron otros mánagers',
        'Revisa intercambios y cómo cambiaron cada plantilla',
        'Detecta qué mánagers están activos y cuáles no',
      ],
      start: 'Revisa los movimientos más recientes buscando jugadores que querías.',
    },
  },
  'season-outlook': {
    en: {
      name: 'Season Outlook',
      what: 'Your chances of making the playoffs and winning it all, in every league.',
      can: [
        'See playoff and title odds for each league',
        'Find the upcoming games that swing your season most',
        'Know what has to happen for you to get in',
      ],
      start: 'Start with the league closest to the playoff line.',
    },
    es: {
      name: 'Pronóstico de temporada',
      what: 'Tus probabilidades de llegar a playoffs y ganar el título, en cada liga.',
      can: [
        'Ve las probabilidades de playoffs y de título en cada liga',
        'Encuentra los próximos partidos que más cambian tu temporada',
        'Entiende qué tiene que pasar para que entres',
      ],
      start: 'Empieza por la liga más cerca de la línea de playoffs.',
    },
  },
  'war-room': {
    en: {
      name: 'War Room',
      what: 'Your strategy desk for one league: scout rivals and plan the week.',
      can: [
        'Scout every manager — record, points and recent form',
        'See your head-to-head record against this week’s opponent',
        'Build a game plan and trade ideas for the rest of the season',
      ],
      start: 'Open Scout and read the card for this week’s opponent.',
    },
    es: {
      name: 'Sala de guerra',
      what: 'Tu mesa de estrategia para una liga: estudia rivales y planea la semana.',
      can: [
        'Estudia a cada mánager: récord, puntos y forma reciente',
        'Ve tu historial contra el rival de esta semana',
        'Arma un plan de juego e ideas de intercambio para el resto de la temporada',
      ],
      start: 'Abre Scout y lee la ficha del rival de esta semana.',
    },
  },
  'draft-hq': {
    en: {
      name: 'Draft HQ',
      what: 'Everything for your drafts: prep, the live board and past results.',
      can: [
        'See when each draft starts and your pick slot',
        'Follow a live draft with suggestions for your next pick',
        'Look back at past drafts and how picks turned out',
      ],
      start: 'Find your next draft and check your pick position.',
    },
    es: {
      name: 'Central del draft',
      what: 'Todo para tus drafts: preparación, el tablero en vivo y resultados pasados.',
      can: [
        'Ve cuándo empieza cada draft y tu turno de selección',
        'Sigue un draft en vivo con sugerencias para tu próxima selección',
        'Revisa drafts pasados y cómo resultaron las selecciones',
      ],
      start: 'Busca tu próximo draft y revisa tu turno.',
    },
  },
  'my-leagues': {
    en: {
      name: 'My Leagues',
      what: 'All your leagues in one list, with the ones that need you on top.',
      can: [
        'Open any league',
        'Sort by sport, name or what needs attention',
        'Import or connect more leagues',
      ],
      start: 'Open the first league in the list.',
    },
    es: {
      name: 'Mis ligas',
      what: 'Todas tus ligas en una lista, con las que te necesitan arriba.',
      can: [
        'Abre cualquier liga',
        'Ordena por deporte, nombre o lo que necesita atención',
        'Importa o conecta más ligas',
      ],
      start: 'Abre la primera liga de la lista.',
    },
  },
  portfolio: {
    en: {
      name: 'Portfolio',
      what: 'Every league you are in, side by side.',
      can: [
        'Compare how you are doing in each league',
        'See which players you own in several leagues',
        'Open any league from its row',
      ],
      start: 'Look for leagues where you are falling behind.',
    },
    es: {
      name: 'Portafolio',
      what: 'Todas tus ligas, una al lado de la otra.',
      can: [
        'Compara cómo vas en cada liga',
        'Ve qué jugadores tienes en varias ligas',
        'Abre cualquier liga desde su fila',
      ],
      start: 'Busca las ligas donde te estás quedando atrás.',
    },
  },
  career: {
    en: {
      name: 'Your career',
      what: 'Your fantasy history across every season and league you have played.',
      can: [
        'See titles, playoff trips and your overall record',
        'Track your level and how you earn more',
        'Share your career card',
      ],
      start: 'Import past seasons so your full history counts.',
    },
    es: {
      name: 'Tu carrera',
      what: 'Tu historial de fantasy en cada temporada y liga que jugaste.',
      can: [
        'Ve títulos, playoffs y tu récord total',
        'Sigue tu nivel y cómo ganar más',
        'Comparte tu tarjeta de carrera',
      ],
      start: 'Importa temporadas pasadas para que cuente todo tu historial.',
    },
  },
  rankings: {
    en: {
      name: 'Rankings',
      what: 'How you rank against other AllFantasy managers — and why.',
      can: [
        'See the community board, your portfolio and one league',
        'Open any rank to see exactly what earned it',
        'Find out how many managers you are ranked against',
      ],
      start: 'Find your row and tap it to see the breakdown.',
    },
    es: {
      name: 'Rankings',
      what: 'Cómo te comparas con otros mánagers de AllFantasy, y por qué.',
      can: [
        'Ve la tabla de la comunidad, tu portafolio y una liga',
        'Abre cualquier posición para ver qué la explica',
        'Descubre contra cuántos mánagers estás clasificado',
      ],
      start: 'Busca tu fila y tócala para ver el detalle.',
    },
  },
  tools: {
    en: {
      name: 'Tools',
      what: 'Every extra tool, grouped by the job you came to do.',
      can: [
        'Decide something today — tools with a deadline',
        'Understand something — stats and analysis',
        'Share something — cards and recaps',
      ],
      start: 'Pick the group that matches what you need right now.',
    },
    es: {
      name: 'Herramientas',
      what: 'Todas las herramientas extra, agrupadas según lo que vienes a hacer.',
      can: [
        'Decidir algo hoy: herramientas con fecha límite',
        'Entender algo: estadísticas y análisis',
        'Compartir algo: tarjetas y resúmenes',
      ],
      start: 'Elige el grupo que encaja con lo que necesitas ahora.',
    },
  },
  notifications: {
    en: {
      name: 'Notifications',
      what: 'Everything that happened in your leagues, with what to do about it.',
      can: [
        'See what needs action today first',
        'Filter by trades, free agents, lineups or news',
        'Mute the kinds of alerts you do not want',
      ],
      start: 'Clear the “act today” items first.',
    },
    es: {
      name: 'Notificaciones',
      what: 'Todo lo que pasó en tus ligas, con qué hacer al respecto.',
      can: [
        'Ve primero lo que requiere acción hoy',
        'Filtra por intercambios, agentes libres, alineaciones o noticias',
        'Silencia los tipos de aviso que no quieras',
      ],
      start: 'Resuelve primero lo de «actuar hoy».',
    },
  },
  'league-settings': {
    en: {
      name: 'League settings',
      what: 'This league’s rules: scoring, roster spots, playoffs and deadlines.',
      can: [
        'Check how players score points here',
        'See roster slots, trade deadline and playoff format',
        'Change settings if you run a league made on AllFantasy',
      ],
      start: 'Read the scoring first — it changes who is worth starting.',
    },
    es: {
      name: 'Ajustes de la liga',
      what: 'Las reglas de esta liga: puntuación, plantilla, playoffs y plazos.',
      can: [
        'Revisa cómo suman puntos los jugadores aquí',
        'Ve las posiciones de la plantilla, el plazo de intercambios y el formato de playoffs',
        'Cambia ajustes si administras una liga creada en AllFantasy',
      ],
      start: 'Lee primero la puntuación: cambia a quién conviene poner.',
    },
  },
  devy: {
    en: {
      name: 'Devy',
      what: 'College players you can roster before they turn pro, across your devy leagues.',
      can: [
        'See your college players and their draft stock',
        'Find college prospects worth adding',
        'Track who is about to enter the pro draft',
      ],
      start: 'Check which of your college players are draft-eligible this year.',
    },
    es: {
      name: 'Devy',
      what: 'Jugadores universitarios que puedes tener antes de que sean profesionales, en tus ligas devy.',
      can: [
        'Ve tus jugadores universitarios y su valor de draft',
        'Encuentra prospectos universitarios que vale la pena sumar',
        'Sigue quién está por entrar al draft profesional',
      ],
      start: 'Revisa cuáles de tus universitarios pueden ir al draft este año.',
    },
  },
  'devy-league': {
    en: {
      name: 'Devy (league)',
      what: 'This league’s college players and devy slots.',
      can: [
        'See which college players each team holds',
        'Check your open devy slots',
        'Find prospects still available in this league',
      ],
      start: 'Fill any open devy slot first.',
    },
    es: {
      name: 'Devy (liga)',
      what: 'Los jugadores universitarios y espacios devy de esta liga.',
      can: [
        'Ve qué universitarios tiene cada equipo',
        'Revisa tus espacios devy libres',
        'Encuentra prospectos aún disponibles en esta liga',
      ],
      start: 'Llena primero cualquier espacio devy libre.',
    },
  },
  'defense-hub': {
    en: {
      name: 'Defense Hub',
      what: 'Defensive players for leagues that score individual defenders (IDP).',
      can: [
        'See your defenders and their snap counts',
        'Find defenders worth adding',
        'Learn what scores most in IDP — usually tackles',
      ],
      start: 'Make sure every defender you start is playing full snaps.',
    },
    es: {
      name: 'Centro defensivo',
      what: 'Jugadores defensivos para ligas que puntúan defensores individuales (IDP).',
      can: [
        'Ve tus defensores y cuántas jugadas disputan',
        'Encuentra defensores que vale la pena sumar',
        'Aprende qué suma más en IDP: normalmente los tackles',
      ],
      start: 'Asegúrate de que cada defensor titular juegue todas las jugadas.',
    },
  },
  commissioner: {
    en: {
      name: 'Commissioner',
      what: 'Tools for running a league: health, activity and settings.',
      can: [
        'See which managers have gone quiet',
        'Check league health and anything that needs fixing',
        'Set up league chat and other league-wide tools',
      ],
      start: 'Look at the inactive managers first.',
    },
    es: {
      name: 'Comisionado',
      what: 'Herramientas para administrar una liga: salud, actividad y ajustes.',
      can: [
        'Ve qué mánagers dejaron de estar activos',
        'Revisa la salud de la liga y lo que hay que arreglar',
        'Configura el chat de la liga y otras herramientas generales',
      ],
      start: 'Revisa primero a los mánagers inactivos.',
    },
  },
}

/** URL segment → guide. A segment with no guide returns null and the strip draws nothing. */
const SEGMENT_TO_GUIDE: Record<string, ScreenGuideKey> = {
  'my-team': 'my-team',
  matchup: 'matchup',
  trades: 'trades',
  waivers: 'waivers',
  players: 'players',
  week: 'week',
  live: 'live',
  standings: 'standings',
  schedule: 'schedule',
  moves: 'moves',
  'season-outlook': 'season-outlook',
  'war-room': 'war-room',
  'draft-hq': 'draft-hq',
  leagues: 'my-leagues',
  portfolio: 'portfolio',
  career: 'career',
  rankings: 'rankings',
  tools: 'tools',
  notifications: 'notifications',
  'league-settings': 'league-settings',
  devy: 'devy',
  'devy-league': 'devy-league',
  'defense-hub': 'defense-hub',
  commissioner: 'commissioner',
}

/**
 * The guide for a /core pathname. `/core` itself is the cross-league Home, or one league's
 * Overview when a league is selected — two different pages that share a URL.
 */
export function screenGuideKeyFor(pathname: string | null | undefined, inLeague: boolean): ScreenGuideKey | null {
  if (!pathname || !pathname.startsWith('/core')) return null
  const segment = pathname.replace(/^\/core\/?/, '').split('/')[0] ?? ''
  if (segment === '') return inLeague ? 'overview' : 'home'
  return SEGMENT_TO_GUIDE[segment] ?? null
}

export function screenGuide(key: ScreenGuideKey, language: string | null | undefined): ScreenGuide {
  const entry = GUIDES[key]
  return language === 'es' ? entry.es : entry.en
}

/** Where a guide's page lives. League pages keep the league that is selected. */
export function screenGuideHref(key: ScreenGuideKey, leagueId: string | null): string {
  const segment = key === 'home' || key === 'overview' ? '' : key === 'my-leagues' ? 'leagues' : key
  const base = segment ? `/core/${segment}` : '/core'
  return leagueId ? `${base}?league=${encodeURIComponent(leagueId)}` : base
}

/**
 * Pages that only make sense with ONE league selected. "How it works" still explains them with no
 * league held, but says to pick a league first rather than linking to an empty screen.
 */
export const LEAGUE_ONLY_GUIDES: ReadonlySet<ScreenGuideKey> = new Set<ScreenGuideKey>([
  'overview',
  'my-team',
  'matchup',
  'waivers',
  'schedule',
  'moves',
  'standings',
  'war-room',
  'league-settings',
  'devy-league',
  'defense-hub',
])

/**
 * The "How AllFantasy works" groups, in reading order. Conditional pages (Devy, Defense Hub,
 * Commissioner) are left out of the list: they appear in the nav only for the leagues that have
 * them, and their own strip explains them when they do.
 */
export const HOW_IT_WORKS_GROUPS: ReadonlyArray<{ id: 'week' | 'league' | 'all'; keys: ScreenGuideKey[] }> = [
  { id: 'week', keys: ['week', 'my-team', 'matchup', 'waivers', 'trades', 'live'] },
  { id: 'league', keys: ['overview', 'standings', 'schedule', 'moves', 'war-room', 'league-settings', 'draft-hq'] },
  { id: 'all', keys: ['home', 'my-leagues', 'players', 'season-outlook', 'notifications', 'career', 'rankings', 'tools'] },
]

export const ALL_SCREEN_GUIDE_KEYS = Object.keys(GUIDES) as ScreenGuideKey[]
