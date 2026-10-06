/**
 * Spanish for the league bar's recommendation (2026-10-04).
 *
 * On a league's Overview, the context bar shows the top Decision OS recommendation — its first action
 * and rationale (`page.tsx` → `LeagueRecommendation`). Those come from the manager builders in
 * `lib/decision-os/phase6/recommendations/recommendations.ts` (the per-manager assembler), which
 * write deterministic English templates, and the bar printed them raw: the last English a
 * Spanish reader met on a league's Overview. Translated at render, in the client, where the language
 * is known.
 *
 * Covers the MANAGER builders only — the set the bar can show. The commissioner and platform builders
 * in the same file feed other surfaces and are left in English here.
 * `__tests__/core-app/league-recommendation-text.test.tsx` scans the manager section so a new sentence
 * without Spanish fails. Unknown text passes through. PURE and client-safe: no imports.
 */

const ES: Record<string, string> = {
  // buildEngagementBoost
  'Improved lineup setting, waiver participation, and seasonal roster performance':
    'Mejores alineaciones, más participación en agentes libres y mejor rendimiento de la plantilla en la temporada',
  'Enable weekly lineup reminder notifications': 'Activa los recordatorios semanales de alineación',
  'Reduces missed start/sit decisions': 'Reduce las decisiones de titular o suplente que se te pasan',
  'Check lineup 48 hours before game day': 'Revisa tu alineación 48 horas antes del día de partido',
  'Allows time for injury adjustment before lock': 'Te da tiempo para ajustar por lesiones antes del cierre',
  'Review waiver wire every Tuesday morning': 'Revisa los agentes libres cada martes por la mañana',
  'Waiver claims typically process overnight': 'Los reclamos suelen procesarse durante la noche',

  // buildLineupDiscipline
  'Fewer last-minute changes, reduced bench regret, more consistent start/sit decisions':
    'Menos cambios de último minuto, menos arrepentimiento con la banca y decisiones de titular o suplente más consistentes',
  'Lock lineup decisions 24 hours before kickoff': 'Cierra tus decisiones de alineación 24 horas antes del inicio',
  'Prevents impulse changes after partial game data': 'Evita cambios impulsivos con datos parciales de los partidos',
  'Build a pre-week start/sit shortlist on Tuesdays': 'Arma cada martes una lista corta de titulares y suplentes para la semana',
  'Proactive ranking reduces game-day anxiety': 'Ordenar con anticipación reduce la ansiedad del día de partido',
  'Commit to bench decisions by Thursday night': 'Decide tu banca antes del jueves por la noche',
  'Reduces bench regret from late-week changes': 'Reduce el arrepentimiento por cambios a final de semana',

  // buildTradeCoaching
  'Higher trade acceptance rate, more balanced proposals, improved roster construction via trades':
    'Más intercambios aceptados, propuestas más equilibradas y una plantilla mejor armada con intercambios',
  'Research fair market value before proposing': 'Investiga el valor justo de mercado antes de proponer',
  'Reduces one-sided proposals that get rejected': 'Reduce las propuestas desequilibradas que terminan rechazadas',
  'Add a value sweetener (pick or depth piece) to stalled offers':
    'Añade un incentivo (una selección o un jugador de profundidad) a las ofertas estancadas',
  'Shows good faith and improves acceptance rate': 'Muestra buena fe y mejora la tasa de aceptación',
  'Check trade value charts for current buy-low/sell-high opportunities':
    'Consulta las tablas de valor para encontrar oportunidades de comprar barato y vender caro',
  'Leverages market timing for better proposals': 'Aprovecha el momento del mercado para hacer mejores propuestas',

  // buildWaiverOpportunity
  'Improved roster depth and flexibility through targeted waiver wire use':
    'Más profundidad y flexibilidad en la plantilla con un uso dirigido de los agentes libres',
  'Review available players and your league’s pickup rules': 'Revisa los jugadores disponibles y las reglas de fichajes de tu liga',
  'Check when claims process or whether free agents can be added immediately':
    'Comprueba cuándo se procesan los reclamos o si los agentes libres se pueden añadir al instante',
  'Set pickup targets before your league’s next deadline': 'Define tus objetivos de fichaje antes del próximo plazo de tu liga',
  'Use your league’s actual claim schedule when planning moves': 'Planifica tus movimientos con el calendario real de reclamos de tu liga',
  'Monitor injury reports for pickup opportunities': 'Sigue los reportes de lesiones para encontrar oportunidades de fichaje',
  'Streamlining transactions improves roster ceiling': 'Agilizar los movimientos eleva el techo de tu plantilla',

  // buildLeagueParticipation
  'Improved league culture, higher commish satisfaction, better seasonal experience':
    'Mejor ambiente en la liga, un comisionado más satisfecho y una mejor experiencia de temporada',
  'Respond to commissioner polls and surveys': 'Responde las encuestas y votaciones del comisionado',
  'Signals active membership, improves commissioner experience':
    'Demuestra que participas activamente y mejora la experiencia del comisionado',
  'Comment on matchup results or trade blocks': 'Comenta los resultados de los enfrentamientos o los jugadores en venta',
  'Increases league engagement culture': 'Aumenta la participación en la liga',
  'Set up push notifications for lineup lock reminders': 'Activa las notificaciones de recordatorio de cierre de alineación',
  'Prevents forfeits from missed lineups': 'Evita perder partidos por alineaciones sin poner',

  // buildDraftPreparation
  'Better draft positioning, stronger initial roster quality, reduced in-season adjustment burden':
    'Mejor posición en el draft, una plantilla inicial más fuerte y menos ajustes durante la temporada',
  'Study ADP and positional value tiers before the draft': 'Estudia el ADP y los niveles de valor por posición antes del draft',
  'A strong draft foundation matters most when in-season roster changes are few':
    'Una buena base en el draft importa más cuando hay pocos cambios de plantilla en la temporada',
  'Prepare a ranked position board for each round': 'Prepara un tablero ordenado por posición para cada ronda',
  'Reduces decision fatigue during live draft': 'Reduce la fatiga de decisiones durante el draft en vivo',
  'Identify 3-4 handcuff running backs to target in late rounds':
    'Identifica 3 o 4 corredores suplentes (handcuffs) para las rondas finales',
  'Provides injury insurance without waiver wire dependency': 'Te protege ante lesiones sin depender de los agentes libres',
}

/** A recommendation sentence in the reader's language; unknown text passes through unchanged. */
export function leagueRecommendationText(text: string | null | undefined, language: string): string {
  if (!text) return ''
  if (language !== 'es') return text
  return ES[text] ?? text
}
