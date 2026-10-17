/**
 * lib/i18n/scoring-stats/basketball.ts — Spanish for the NBA and NCAAB scoring editors.
 *
 * Keyed by the exact English in `lib/nba-scoring/NbaScoringCategories.ts`,
 * `lib/ncaab-scoring/NcaabScoringCategories.ts` and both sports' preset registries
 * (whose descriptions and warnings reach the editor through the API). Double-double and
 * triple-double stay as the Spanish-language broadcasts say them.
 */

import type { StatTable } from './index'

export const BASKETBALL_STATS_ES: StatTable = {
  // ── Categories ──
  'General': 'General',
  'Shooting': 'Tiro',
  'Free Throws': 'Tiros libres',
  'Three-Point': 'Triples',
  'Rebounds': 'Rebotes',
  'Playmaking': 'Creación de juego',
  'Defense': 'Defensa',
  'Discipline': 'Disciplina',
  'Bonuses': 'Bonos',
  'Advanced': 'Avanzado',

  // ── General ──
  'Points Scored': 'Puntos anotados',
  'Seconds Played': 'Segundos jugados',
  'Minutes Played': 'Minutos jugados',
  'Plus/Minus': 'Más/menos',

  // ── Shooting ──
  'Field Goals Made': 'Tiros de campo anotados',
  'Field Goals Attempted': 'Tiros de campo intentados',
  'Field Goals Missed': 'Tiros de campo fallados',
  '2-Point Field Goals Made': 'Tiros de 2 puntos anotados',
  '2-Point Field Goals Attempted': 'Tiros de 2 puntos intentados',
  '2-Point Field Goals Missed': 'Tiros de 2 puntos fallados',

  // ── Free throws ──
  'Free Throws Made': 'Tiros libres anotados',
  'Free Throws Attempted': 'Tiros libres intentados',
  'Free Throws Missed': 'Tiros libres fallados',

  // ── Three-point ──
  '3-Point Shots Made': 'Triples anotados',
  '3-Point Shots Attempted': 'Triples intentados',
  '3-Point Shots Missed': 'Triples fallados',

  // ── Rebounds ──
  'Rebound': 'Rebote',
  'Offensive Rebound': 'Rebote ofensivo',
  'Defensive Rebound': 'Rebote defensivo',

  // ── Playmaking ──
  'Assist': 'Asistencia',
  'Turnover': 'Pérdida de balón',

  // ── Defense ──
  'Steal': 'Robo',
  'Block': 'Tapón',

  // ── Discipline ──
  'Personal Foul': 'Falta personal',
  'Technical Foul': 'Falta técnica',
  'Flagrant Foul': 'Falta flagrante',

  // ── Bonuses ──
  'Double-Double': 'Doble-doble',
  'Triple-Double': 'Triple-doble',
  '20+ Points Bonus': 'Bono por 20+ puntos',
  '30+ Points Bonus': 'Bono por 30+ puntos',
  '40+ Points Bonus': 'Bono por 40+ puntos',
  '50+ Points Bonus': 'Bono por 50+ puntos',
  '10+ Assists Bonus': 'Bono por 10+ asistencias',
  '15+ Assists Bonus': 'Bono por 15+ asistencias',
  '10+ Rebounds Bonus': 'Bono por 10+ rebotes',
  '15+ Rebounds Bonus': 'Bono por 15+ rebotes',
  '20+ Rebounds Bonus': 'Bono por 20+ rebotes',
  '10+ Made Field Goals Bonus': 'Bono por 10+ tiros de campo anotados',
  '5+ Made 3PT Bonus': 'Bono por 5+ triples anotados',

  // ── Advanced (premium) ──
  'Usage Rate Bonus': 'Bono por tasa de uso',
  'Efficiency Bonus': 'Bono por eficiencia',
  'True Shooting Bonus': 'Bono por tiro verdadero',
  'Assist-to-Turnover Bonus': 'Bono por asistencias/pérdidas',
  'Tempo-Adjusted Bonus': 'Bono ajustado al ritmo',

  // ── Helpers ──
  '0.5 pts per point scored (AF default)': '0.5 pts por punto anotado (predeterminado de AF)',
  '0.5 bonus per made 3 (AF default)': '0.5 de bono por triple anotado (predeterminado de AF)',
  '1 pt per total rebound (AF default)': '1 pt por rebote total (predeterminado de AF)',
  '1 pt per assist (AF default)': '1 pt por asistencia (predeterminado de AF)',
  '2 pts per steal (AF default)': '2 pts por robo (predeterminado de AF)',
  '2 pts per block (AF default)': '2 pts por tapón (predeterminado de AF)',
  'Bonus based on usage rate thresholds': 'Bono según umbrales de tasa de uso',
  'Bonus based on game efficiency rating': 'Bono según la valoración de eficiencia del partido',
  'Bonus for high true shooting percentage games': 'Bono por partidos con alto porcentaje de tiro verdadero',
  'Bonus for high assist-to-turnover ratio games': 'Bono por partidos con alta relación asistencias/pérdidas',
  'Rare in college but supported': 'Poco común en universitario, pero se admite',
  'Bonus adjusted for pace of play (college-specific)': 'Bono ajustado al ritmo de juego (propio del universitario)',

  // ── Preset descriptions and warnings (served by the API from the preset registries) ──
  'Balanced NBA scoring optimized for AllFantasy league types including specialty formats.':
    'Puntuación NBA equilibrada, optimizada para los tipos de liga de AllFantasy, incluidos los formatos especiales.',
  "Sleeper-compatible NBA scoring categories. Based on Sleeper's documented default basketball scoring settings.":
    'Categorías de puntuación NBA compatibles con Sleeper, basadas en la puntuación de baloncesto predeterminada que documenta Sleeper.',
  "This scoring preset is based on Sleeper's default format. Specialty leagues (Zombie, Survivor, Tournament, Guillotine, Big Brother) are optimized for AllFantasy scoring and may not score exactly as intended under this preset.":
    'Este preset se basa en el formato predeterminado de Sleeper. Las ligas especiales (Zombie, Survivor, Torneo, Guillotina, Big Brother) están optimizadas para la puntuación de AllFantasy y quizá no puntúen exactamente como se espera con este preset.',
  'ESPN default points-league scoring values for NBA.': 'Valores de puntuación predeterminados de ESPN para ligas de puntos de NBA.',
  "This scoring preset is based on ESPN's default format. Specialty leagues are optimized for AllFantasy scoring and may not score exactly as intended under this preset.":
    'Este preset se basa en el formato predeterminado de ESPN. Las ligas especiales están optimizadas para la puntuación de AllFantasy y quizá no puntúen exactamente como se espera con este preset.',
  'Yahoo default head-to-head points scoring for NBA.': 'Puntuación predeterminada de Yahoo para ligas de puntos cara a cara de NBA.',
  "This scoring preset is based on Yahoo's default format. Specialty leagues are optimized for AllFantasy scoring and may not score exactly as intended under this preset.":
    'Este preset se basa en el formato predeterminado de Yahoo. Las ligas especiales están optimizadas para la puntuación de AllFantasy y quizá no puntúen exactamente como se espera con este preset.',
  'Custom scoring values. Start from any preset and edit individual stat values.':
    'Valores de puntuación personalizados. Parte de cualquier preset y edita cada estadística.',
  'Balanced NCAAB scoring optimized for AllFantasy league types including bracket mode and specialty formats.':
    'Puntuación NCAAB equilibrada, optimizada para los tipos de liga de AllFantasy, incluidos el modo bracket y los formatos especiales.',
  'Sleeper-compatible NCAAB scoring. Sleeper does not offer dedicated college basketball fantasy. This uses a Sleeper-style points structure.':
    'Puntuación NCAAB compatible con Sleeper. Sleeper no ofrece fantasy de baloncesto universitario, así que esto usa una estructura de puntos al estilo de Sleeper.',
  'Sleeper does not currently support NCAAB fantasy leagues. This is a compatibility preset. Specialty leagues are optimized for AllFantasy scoring.':
    'Sleeper no admite hoy ligas fantasy de NCAAB. Este es un preset de compatibilidad. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'ESPN-compatible NCAAB points baseline.': 'Base de puntos NCAAB compatible con ESPN.',
  'This is a compatible baseline for ESPN-style scoring. Specialty leagues are optimized for AllFantasy scoring.':
    'Esta es una base compatible con la puntuación al estilo de ESPN. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'Yahoo-compatible NCAAB points baseline.': 'Base de puntos NCAAB compatible con Yahoo.',
  'This is a compatible baseline for Yahoo-style scoring. Specialty leagues are optimized for AllFantasy scoring.':
    'Esta es una base compatible con la puntuación al estilo de Yahoo. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'Custom scoring values.': 'Valores de puntuación personalizados.',
}
