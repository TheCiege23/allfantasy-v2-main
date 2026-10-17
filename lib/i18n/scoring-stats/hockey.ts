/**
 * lib/i18n/scoring-stats/hockey.ts — Spanish for the NHL scoring editor.
 *
 * Keyed by the exact English in `lib/nhl-scoring/NhlScoringCategories.ts` and the NHL preset
 * registry (whose descriptions and warnings reach the editor through the API). Analytics names
 * (Corsi, Fenwick, xG, xA, GSAA, xGA, GAA) stay as the hockey world writes them.
 */

import type { StatTable } from './index'

export const HOCKEY_STATS_ES: StatTable = {
  // ── Categories ──
  'Offense': 'Ofensiva',
  'Defense': 'Defensa',
  'Discipline': 'Disciplina',
  'Goalie Core': 'Portero: básico',
  'Goalie Efficiency': 'Portero: eficiencia',
  'Goalie Bonuses': 'Portero: bonos',
  'Bonuses': 'Bonos',
  'Misc': 'Varios',
  'Advanced': 'Avanzado',

  // ── Offense ──
  'Goal': 'Gol',
  'Assist': 'Asistencia',
  'Point (combined)': 'Punto (combinado)',
  'Power Play Goal': 'Gol en power play',
  'Power Play Assist': 'Asistencia en power play',
  'Power Play Point': 'Punto en power play',
  'Short-Handed Goal': 'Gol en inferioridad',
  'Short-Handed Assist': 'Asistencia en inferioridad',
  'Short-Handed Point': 'Punto en inferioridad',
  'Game-Winning Goal': 'Gol de la victoria',
  'Overtime Goal': 'Gol en tiempo extra',
  'Shots on Goal': 'Tiros a puerta',
  'Shooting % Bonus': 'Bono por % de tiro',
  'Faceoff Wins': 'Faceoffs ganados',
  'Faceoff Losses': 'Faceoffs perdidos',

  // ── Defense ──
  'Blocked Shots': 'Tiros bloqueados',
  'Hits': 'Golpes',
  'Takeaways': 'Recuperaciones',
  'Giveaways': 'Pérdidas',
  'Plus/Minus': 'Más/menos',

  // ── Discipline ──
  'Penalty Minutes': 'Minutos de penalización',
  'Minor Penalty': 'Penalización menor',
  'Major Penalty': 'Penalización mayor',
  'Misconduct': 'Mala conducta',

  // ── Goalie core ──
  'Win': 'Victoria',
  'Loss': 'Derrota',
  'Overtime/Shootout Loss': 'Derrota en tiempo extra o shootout',
  'Save': 'Atajada',
  'Goal Against': 'Gol en contra',
  'Shots Against': 'Tiros en contra',
  'Empty Net Goal Against': 'Gol en contra con portería vacía',
  'Goalie Goal': 'Gol del portero',
  'Goalie Assist': 'Asistencia del portero',
  'Goalie Penalty Minutes': 'Minutos de penalización del portero',

  // ── Goalie efficiency ──
  'Shutout': 'Blanqueada',
  'Save % Bonus': 'Bono por % de atajadas',
  'GAA Bonus': 'Bono por GAA',
  'Time on Ice (minutes)': 'Tiempo en hielo (minutos)',

  // ── Goalie bonuses ──
  '40+ Save Game': 'Partido de 40+ atajadas',
  '50+ Save Game': 'Partido de 50+ atajadas',
  'Overtime Win': 'Victoria en tiempo extra',
  'Shootout Win': 'Victoria en shootout',

  // ── Bonuses ──
  'Hat Trick': 'Hat trick',
  'Gordie Howe Hat Trick': 'Hat trick Gordie Howe',
  '3+ Assist Game': 'Partido de 3+ asistencias',
  '5+ Point Game': 'Partido de 5+ puntos',
  'Multi-Goal Game (2+)': 'Partido de varios goles (2+)',
  'Multi-Assist Game (2+)': 'Partido de varias asistencias (2+)',
  '10+ Shot Game': 'Partido de 10+ tiros',
  '5+ Hit Game': 'Partido de 5+ golpes',
  '5+ Block Game': 'Partido de 5+ bloqueos',

  // ── Misc ──
  'Empty Net Goal': 'Gol con portería vacía',
  'Shootout Goal': 'Gol en shootout',
  'Shootout Miss': 'Fallo en shootout',

  // ── Advanced (premium) ──
  'Corsi Bonus': 'Bono Corsi',
  'Fenwick Bonus': 'Bono Fenwick',
  'Expected Goals (xG)': 'Goles esperados (xG)',
  'Expected Assists (xA)': 'Asistencias esperadas (xA)',
  'High Danger Chances': 'Ocasiones de alto peligro',
  'Zone Starts Bonus': 'Bono por inicios en zona',
  'Goalie GSAA': 'GSAA del portero',
  'Goalie xGA': 'xGA del portero',

  // ── Helpers ──
  'Optional combined goal+assist stat': 'Estadística opcional que combina gol + asistencia',
  'Bonus on top of goal value': 'Bono sumado al valor del gol',
  'Bonus on top of assist value': 'Bono sumado al valor de la asistencia',
  'Use instead of individual PP goal/assist': 'Úsalo en lugar de gol/asistencia en power play por separado',
  'Use instead of individual SHG/SHA': 'Úsalo en lugar de SHG/SHA por separado',
  'Bonus per point of shooting percentage above 10%': 'Bono por cada punto de porcentaje de tiro por encima del 10%',
  'Per penalty minute (negative recommended)': 'Por minuto de penalización (se recomienda negativo)',
  'Per 2-minute minor': 'Por cada menor de 2 minutos',
  'Per 5-minute major': 'Por cada mayor de 5 minutos',
  'Per 10-minute misconduct': 'Por cada mala conducta de 10 minutos',
  'Use instead of separate saves/GA': 'Úsalo en lugar de atajadas/GA por separado',
  'Bonus per 0.010 save % above .900': 'Bono por cada 0.010 de % de atajadas por encima de .900',
  'Bonus for GAA below 2.50': 'Bono por GAA por debajo de 2.50',
  'Points per minute played': 'Puntos por minuto jugado',
  'Goal + Assist + Fight in same game': 'Gol + asistencia + pelea en el mismo partido',
  'Skater scores into empty net': 'El jugador anota con la portería vacía',
  'Shot attempt differential bonus (CF%)': 'Bono por diferencial de intentos de tiro (CF%)',
  'Unblocked shot attempt differential (FF%)': 'Diferencial de intentos de tiro no bloqueados (FF%)',
  'Bonus per expected goal generated': 'Bono por cada gol esperado generado',
  'Bonus per expected primary assist': 'Bono por cada asistencia primaria esperada',
  'Bonus per high-danger scoring chance': 'Bono por cada ocasión de gol de alto peligro',
  'Offensive zone start percentage bonus': 'Bono por porcentaje de inicios en zona ofensiva',
  'Goals Saved Above Average bonus': 'Bono por goles salvados sobre el promedio',
  'Expected Goals Against — bonus for outperforming': 'Goles esperados en contra: bono por superarlos',

  // ── Preset descriptions and warnings (served by the API from the preset registry) ──
  'Balanced NHL scoring optimized for AllFantasy league types including specialty formats.':
    'Puntuación NHL equilibrada, optimizada para los tipos de liga de AllFantasy, incluidos los formatos especiales.',
  'Sleeper-compatible NHL scoring. Note: Sleeper does not currently offer standard fantasy hockey leagues. This is a compatibility preset.':
    'Puntuación NHL compatible con Sleeper. Nota: Sleeper no ofrece hoy ligas fantasy de hockey estándar. Este es un preset de compatibilidad.',
  'Sleeper does not currently support fantasy hockey leagues. This preset uses a Sleeper-friendly points structure but is not an official Sleeper preset. Specialty leagues are optimized for AllFantasy scoring.':
    'Sleeper no admite hoy ligas fantasy de hockey. Este preset usa una estructura de puntos afín a Sleeper, pero no es un preset oficial de Sleeper. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'ESPN-compatible NHL H2H points baseline. ESPN supports retroactive recalculation when scoring changes.':
    'Base de puntos H2H de NHL compatible con ESPN. ESPN admite recalcular de forma retroactiva cuando cambia la puntuación.',
  "This scoring preset is based on ESPN's format. Specialty leagues are optimized for AllFantasy scoring and may not score exactly as intended under this preset.":
    'Este preset se basa en el formato de ESPN. Las ligas especiales están optimizadas para la puntuación de AllFantasy y quizá no puntúen exactamente como se espera con este preset.',
  'Yahoo default H2H points scoring for NHL. Yahoo uses Head-to-Head Points as the default private-league scoring type.':
    'Puntuación H2H por puntos predeterminada de Yahoo para NHL. Yahoo usa los puntos cara a cara como tipo de puntuación predeterminado en ligas privadas.',
  "This scoring preset is based on Yahoo's default format. Specialty leagues are optimized for AllFantasy scoring and may not score exactly as intended under this preset.":
    'Este preset se basa en el formato predeterminado de Yahoo. Las ligas especiales están optimizadas para la puntuación de AllFantasy y quizá no puntúen exactamente como se espera con este preset.',
  'Custom scoring values.': 'Valores de puntuación personalizados.',
}
