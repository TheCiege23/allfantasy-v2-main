/**
 * lib/i18n/scoring-stats/baseball.ts — Spanish for the MLB scoring editor.
 *
 * Keyed by the exact English in `lib/mlb-scoring/MlbScoringCategories.ts` and the MLB preset
 * registry (whose descriptions and warnings reach the editor through the API). Terms follow
 * Spanish-language MLB broadcasts: jonrón, carrera impulsada, ponche, base por bolas, out.
 * Sabermetric names (OPS, wOBA, wRC+, FIP, xERA, BABIP) stay as written.
 */

import type { StatTable } from './index'

export const BASEBALL_STATS_ES: StatTable = {
  // ── Categories ──
  'Batting': 'Bateo',
  'Power': 'Poder',
  'Discipline': 'Disciplina',
  'Base Running': 'Corrido de bases',
  'Pitching': 'Pitcheo',
  'Results': 'Resultados',
  'Efficiency': 'Eficiencia',
  'Control': 'Control del pitcheo',
  'Bonuses': 'Bonos',
  'Misc': 'Varios',
  'Advanced': 'Avanzado',

  // ── Batting ──
  'Plate Appearances': 'Apariciones al plato',
  'At Bats': 'Turnos al bate',
  'Runs': 'Carreras',
  'Singles': 'Sencillos',
  'Doubles': 'Dobles',
  'Triples': 'Triples',
  'Home Runs': 'Jonrones',
  'Total Bases': 'Bases totales',
  'RBIs': 'Carreras impulsadas',
  'Sacrifice Flies': 'Elevados de sacrificio',
  'Sacrifice Bunts': 'Toques de sacrificio',

  // ── Power ──
  'Grand Slam Bonus': 'Bono por grand slam',
  'Hit For Cycle Bonus': 'Bono por batear el ciclo',
  'Game-Winning RBI Bonus': 'Bono por carrera impulsada de la victoria',
  '2 HR Game Bonus': 'Bono por juego de 2 HR',
  '3 HR Game Bonus': 'Bono por juego de 3 HR',
  '5 RBI Game Bonus': 'Bono por juego de 5 carreras impulsadas',
  '10 Total Bases Game Bonus': 'Bono por juego de 10 bases totales',

  // ── Discipline ──
  'Walk (BB)': 'Base por bolas (BB)',
  'Intentional Walk': 'Base por bolas intencional',
  'Hit By Pitch': 'Golpeado por lanzamiento',
  'Strikeout (K)': 'Ponche (K)',

  // ── Base running ──
  'Stolen Base': 'Base robada',
  'Caught Stealing': 'Atrapado robando',
  'Multi-Steal Game Bonus': 'Bono por juego de varias bases robadas',
  'Ground Into Double Play': 'Roletazo para doble play',

  // ── Pitching ──
  'Outs Recorded': 'Outs registrados',
  'Innings Pitched': 'Entradas lanzadas',
  'Hits Allowed': 'Hits permitidos',
  'Earned Runs': 'Carreras limpias',
  'Runs Allowed': 'Carreras permitidas',
  'Walks Allowed': 'Bases por bolas otorgadas',
  'Hit Batters': 'Bateadores golpeados',
  'Home Runs Allowed': 'Jonrones permitidos',
  'Wild Pitches': 'Lanzamientos descontrolados',
  'Balks': 'Balks',
  'Pickoffs': 'Pickoffs',

  // ── Results ──
  'Win': 'Victoria',
  'Loss': 'Derrota',
  'Save': 'Salvamento',
  'Hold': 'Hold',
  'Save Opportunity': 'Oportunidad de salvamento',
  'Blown Save': 'Salvamento desperdiciado',
  'Complete Game': 'Juego completo',
  'Shutout': 'Blanqueada',
  'No-Hitter': 'Juego sin hits',
  'Perfect Game': 'Juego perfecto',

  // ── Efficiency ──
  'Quality Start': 'Apertura de calidad',
  '10+ Strikeout Game Bonus': 'Bono por juego de 10+ ponches',
  '15+ Strikeout Game Bonus': 'Bono por juego de 15+ ponches',
  'CG Shutout Bonus': 'Bono por blanqueada en juego completo',
  'Perfect Game Bonus': 'Bono por juego perfecto',

  // ── Control ──
  'Strikeouts (Pitcher)': 'Ponches (lanzador)',
  'Walk Penalty': 'Penalización por base por bolas',
  'Strikeout Bonus': 'Bono por ponche',

  // ── Bonuses ──
  '2 HR Game': 'Juego de 2 HR',
  '3 HR Game': 'Juego de 3 HR',
  '5 RBI Game': 'Juego de 5 carreras impulsadas',
  '10 Total Bases Game': 'Juego de 10 bases totales',
  'Multi-Steal Game': 'Juego de varias bases robadas',
  '10+ Strikeout Game': 'Juego de 10+ ponches',
  '15+ Strikeout Game': 'Juego de 15+ ponches',
  'Hit For Cycle': 'Batear el ciclo',

  // ── Misc ──
  'Error': 'Error',
  'Pickoff': 'Pickoff',
  'Balk': 'Balk',
  'Wild Pitch': 'Lanzamiento descontrolado',

  // ── Advanced (premium) ──
  'OPS Bonus': 'Bono por OPS',
  'wOBA Bonus': 'Bono por wOBA',
  'wRC+ Bonus': 'Bono por wRC+',
  'FIP Bonus': 'Bono por FIP',
  'xERA Bonus': 'Bono por xERA',
  'BABIP Bonus': 'Bono por BABIP',
  'Barrel Rate Bonus': 'Bono por tasa de barrels',
  'Exit Velocity Bonus': 'Bono por velocidad de salida',
  'Launch Angle Bonus': 'Bono por ángulo de salida',

  // ── Helpers ──
  'Total bases accumulated (1B=1, 2B=2, 3B=3, HR=4)': 'Bases totales acumuladas (1B=1, 2B=2, 3B=3, HR=4)',
  'Extra bonus per grand slam (on top of home_runs value)': 'Bono extra por grand slam (sumado al valor de home_runs)',
  'Points per out recorded': 'Puntos por out registrado',
  'Points per inning pitched': 'Puntos por entrada lanzada',
  'Additional per-walk penalty on top of walks_allowed': 'Penalización adicional por base por bolas, sumada a walks_allowed',
  '"K-boom" extra per strikeout after 8': '"K-boom": extra por cada ponche a partir del octavo',
  'Bonus points per 0.100 OPS above .700': 'Puntos de bono por cada 0.100 de OPS por encima de .700',
  'Weighted On-Base Average bonus points': 'Puntos de bono por promedio de embasado ponderado (wOBA)',
  'Weighted Runs Created+ bonus (100 = league avg)': 'Bono por carreras creadas ponderadas+ (100 = promedio de la liga)',
  'Fielding Independent Pitching efficiency bonus': 'Bono de eficiencia por pitcheo independiente de la defensa (FIP)',
  'Expected ERA efficiency bonus': 'Bono de eficiencia por ERA esperada',
  'Batting Average on Balls In Play bonus': 'Bono por promedio de bateo en bolas en juego (BABIP)',
  'Bonus per barrel (statcast exit velocity + angle)': 'Bono por barrel (velocidad de salida + ángulo de Statcast)',
  'Bonus per 1 mph above 95 mph exit velocity': 'Bono por cada 1 mph de velocidad de salida por encima de 95 mph',
  'Bonus for optimal launch angle (8–32°)': 'Bono por ángulo de salida óptimo (8–32°)',

  // ── Preset descriptions and warnings (served by the API from the preset registry) ──
  'Balanced MLB scoring optimized for AllFantasy league types including specialty formats.':
    'Puntuación MLB equilibrada, optimizada para los tipos de liga de AllFantasy, incluidos los formatos especiales.',
  'Sleeper-compatible MLB scoring. Note: Sleeper does not currently offer official fantasy baseball support. This is a compatibility baseline using AF stat structure.':
    'Puntuación MLB compatible con Sleeper. Nota: Sleeper no ofrece hoy soporte oficial para fantasy de béisbol. Esta es una base de compatibilidad con la estructura de estadísticas de AF.',
  'Sleeper does not currently support fantasy baseball leagues. This preset uses a Sleeper-friendly stat structure but is not an official Sleeper preset. Specialty leagues are optimized for AllFantasy scoring.':
    'Sleeper no admite hoy ligas fantasy de béisbol. Este preset usa una estructura de estadísticas afín a Sleeper, pero no es un preset oficial de Sleeper. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'ESPN standard points-league scoring for MLB.': 'Puntuación estándar de ESPN para ligas de puntos de MLB.',
  "This scoring preset is based on ESPN's default format. Specialty leagues are optimized for AllFantasy scoring and may not score exactly as intended under this preset.":
    'Este preset se basa en el formato predeterminado de ESPN. Las ligas especiales están optimizadas para la puntuación de AllFantasy y quizá no puntúen exactamente como se espera con este preset.',
  'Yahoo-compatible head-to-head points baseline for MLB.': 'Base de puntos cara a cara de MLB compatible con Yahoo.',
  "This scoring preset is based on Yahoo's default format. Specialty leagues are optimized for AllFantasy scoring and may not score exactly as intended under this preset.":
    'Este preset se basa en el formato predeterminado de Yahoo. Las ligas especiales están optimizadas para la puntuación de AllFantasy y quizá no puntúen exactamente como se espera con este preset.',
  'Custom scoring values.': 'Valores de puntuación personalizados.',
}
