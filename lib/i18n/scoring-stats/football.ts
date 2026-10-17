/**
 * lib/i18n/scoring-stats/football.ts — Spanish for the NFL and NCAAF scoring editors.
 *
 * Keyed by the exact English in `lib/nfl-scoring/NflScoringCategories.ts`,
 * `lib/ncaaf-scoring/NcaafScoringCategories.ts` and both sports' preset registries
 * (whose descriptions and warnings reach the editor through the API). Terms follow
 * Spanish-language NFL broadcasts: TD, FG, PAT, QB and IDP stay as abbreviations, a
 * sack is a "captura", a fumble a "balón suelto" and a tackle a "tacleada".
 */

import type { StatTable } from './index'

export const FOOTBALL_STATS_ES: StatTable = {
  // ── Categories ──
  'Passing': 'Pase',
  'Rushing': 'Carrera',
  'Receiving': 'Recepción',
  'Kicking': 'Pateo',
  'Team Defense': 'Defensa de equipo',
  'Special Teams': 'Equipos especiales',
  'Misc': 'Varios',
  'Bonus': 'Bonos',
  'IDP': 'IDP',
  'Advanced': 'Avanzado',

  // ── Passing ──
  'Passing Yards': 'Yardas por pase',
  'Passing TD': 'TD por pase',
  'Passing 1st Down': 'Primer down por pase',
  '2-Pt Conversion': 'Conversión de 2 puntos',
  'Pass Intercepted': 'Pase interceptado',
  'Pick 6 Thrown': 'Pick 6 lanzado',
  'Pass Completed': 'Pase completo',
  'Incomplete Pass': 'Pase incompleto',
  'Pass Attempts': 'Intentos de pase',
  'QB Sacked': 'QB capturado',
  '40+ Yard Completion Bonus': 'Bono por pase completo de 40+ yardas',
  '40+ Yard Pass TD Bonus': 'Bono por TD de pase de 40+ yardas',
  '50+ Yard Pass TD Bonus': 'Bono por TD de pase de 50+ yardas',
  '300+ Passing Game Bonus': 'Bono por juego de 300+ yardas por pase',
  '400+ Passing Game Bonus': 'Bono por juego de 400+ yardas por pase',
  '500+ Passing Game Bonus': 'Bono por juego de 500+ yardas por pase',

  // ── Rushing ──
  'Rushing Yards': 'Yardas por carrera',
  'Rushing TD': 'TD por carrera',
  'Rushing 1st Down': 'Primer down por carrera',
  'Rush Attempts': 'Intentos de carrera',
  '40+ Yard Rush Bonus': 'Bono por carrera de 40+ yardas',
  '40+ Yard Rush TD Bonus': 'Bono por TD de carrera de 40+ yardas',
  '50+ Yard Rush TD Bonus': 'Bono por TD de carrera de 50+ yardas',
  '100+ Rushing Game Bonus': 'Bono por juego de 100+ yardas por carrera',
  '200+ Rushing Game Bonus': 'Bono por juego de 200+ yardas por carrera',
  '300+ Rushing Game Bonus': 'Bono por juego de 300+ yardas por carrera',

  // ── Receiving ──
  'Reception': 'Recepción',
  'TE Reception Bonus': 'Bono por recepción para TE',
  'Added to the regular reception value for tight ends only.': 'Se suma al valor habitual de recepción solo para los alas cerradas.',
  'Receiving Yards': 'Yardas por recepción',
  'Receiving TD': 'TD por recepción',
  'Receiving 1st Down': 'Primer down por recepción',
  '0-4 Yard Reception Bonus': 'Bono por recepción de 0-4 yardas',
  '5-9 Yard Reception Bonus': 'Bono por recepción de 5-9 yardas',
  '10-19 Yard Reception Bonus': 'Bono por recepción de 10-19 yardas',
  '20-29 Yard Reception Bonus': 'Bono por recepción de 20-29 yardas',
  '30-39 Yard Reception Bonus': 'Bono por recepción de 30-39 yardas',
  '40+ Yard Reception Bonus': 'Bono por recepción de 40+ yardas',
  '40+ Yard Reception TD Bonus': 'Bono por TD de recepción de 40+ yardas',
  '50+ Yard Reception TD Bonus': 'Bono por TD de recepción de 50+ yardas',
  'Reception Bonus - RB': 'Bono por recepción - RB',
  'Reception Bonus - WR': 'Bono por recepción - WR',
  'Reception Bonus - TE': 'Bono por recepción - TE',
  '100+ Receiving Game Bonus': 'Bono por juego de 100+ yardas por recepción',
  '200+ Receiving Game Bonus': 'Bono por juego de 200+ yardas por recepción',
  '300+ Receiving Game Bonus': 'Bono por juego de 300+ yardas por recepción',

  // ── Kicking ──
  'FG Made': 'FG anotado',
  'FG Made (0-19 yards)': 'FG anotado (0-19 yardas)',
  'FG Made (20-29 yards)': 'FG anotado (20-29 yardas)',
  'FG Made (30-39 yards)': 'FG anotado (30-39 yardas)',
  'FG Made (40-49 yards)': 'FG anotado (40-49 yardas)',
  'FG Made (50-59 yards)': 'FG anotado (50-59 yardas)',
  'FG Made (50+ yards)': 'FG anotado (50+ yardas)',
  'FG Made (60+ yards)': 'FG anotado (60+ yardas)',
  'Points per FG yard': 'Puntos por yarda de FG',
  'Points per FG yard over 30': 'Puntos por yarda de FG sobre 30',
  'PAT Made': 'PAT anotado',
  'FG Missed': 'FG fallado',
  'FG Missed (0-19 yards)': 'FG fallado (0-19 yardas)',
  'FG Missed (20-29 yards)': 'FG fallado (20-29 yardas)',
  'FG Missed (30-39 yards)': 'FG fallado (30-39 yardas)',
  'FG Missed (40-49 yards)': 'FG fallado (40-49 yardas)',
  'FG Missed (50-59 yards)': 'FG fallado (50-59 yardas)',
  'FG Missed (50+ yards)': 'FG fallado (50+ yardas)',
  'FG Missed (60+ yards)': 'FG fallado (60+ yardas)',
  'PAT Missed': 'PAT fallado',

  // ── Team defense ──
  'Defense TD': 'TD defensivo',
  'Points Allowed 0': 'Puntos permitidos 0',
  'Points Allowed 1-6': 'Puntos permitidos 1-6',
  'Points Allowed 7-13': 'Puntos permitidos 7-13',
  'Points Allowed 14-20': 'Puntos permitidos 14-20',
  'Points Allowed 21-27': 'Puntos permitidos 21-27',
  'Points Allowed 28-34': 'Puntos permitidos 28-34',
  'Points Allowed 35+': 'Puntos permitidos 35+',
  'Points Per Point Allowed': 'Puntos por punto permitido',
  'Less Than 100 Total Yards Allowed': 'Menos de 100 yardas totales permitidas',
  '100-199 Total Yards Allowed': '100-199 yardas totales permitidas',
  '200-299 Total Yards Allowed': '200-299 yardas totales permitidas',
  '300-349 Total Yards Allowed': '300-349 yardas totales permitidas',
  '350-399 Total Yards Allowed': '350-399 yardas totales permitidas',
  '400-449 Total Yards Allowed': '400-449 yardas totales permitidas',
  '450-499 Total Yards Allowed': '450-499 yardas totales permitidas',
  '500-549 Total Yards Allowed': '500-549 yardas totales permitidas',
  '550+ Total Yards Allowed': '550+ yardas totales permitidas',
  'Points Per Yard Allowed': 'Puntos por yarda permitida',
  '3 and Out': 'Tres y fuera',
  '4th Down Stop': 'Freno en cuarta oportunidad',
  'Hit on QB': 'Golpe al QB',
  'Sacks': 'Capturas',
  'Sack Yards': 'Yardas de captura',
  'Interceptions': 'Intercepciones',
  'INT Return Yards': 'Yardas de retorno de intercepción',
  'Fumble Recovery': 'Balón suelto recuperado',
  'Fumble Return Yards': 'Yardas de retorno de balón suelto',
  'Tackle For Loss': 'Tacleada para pérdida',
  'Solo Tackle': 'Tacleada en solitario',
  'Tackle': 'Tacleada',
  'Safety': 'Safety',
  'Forced Fumble': 'Balón suelto forzado',
  'Blocked Kick': 'Patada bloqueada',
  'Forced Punt': 'Despeje forzado',
  'Pass Defended': 'Pase defendido',
  '2-Pt Conversion Returns': 'Retornos de conversión de 2 puntos',
  'Kick/Punt Return TD': 'TD por retorno de patada o despeje',
  'Missed FG Return Yards': 'Yardas de retorno de FG fallado',
  'Blocked Kick Return Yards': 'Yardas de retorno de patada bloqueada',

  // ── Special teams ──
  'Special Teams TD': 'TD de equipos especiales',
  'Special Teams Forced Fumble': 'Balón suelto forzado en equipos especiales',
  'Special Teams Fumble Recovery': 'Balón suelto recuperado en equipos especiales',
  'Special Teams Solo Tackle': 'Tacleada en solitario en equipos especiales',
  'Punt Return Yards': 'Yardas de retorno de despeje',
  'Kick Return Yards': 'Yardas de retorno de patada',
  'Special Teams Player TD': 'TD de jugador de equipos especiales',
  'ST Player Forced Fumble': 'Balón suelto forzado por jugador de EE',
  'ST Player Fumble Recovery': 'Balón suelto recuperado por jugador de EE',
  'ST Player Solo Tackle': 'Tacleada en solitario de jugador de EE',
  'Special Teams Player Forced Fumble': 'Balón suelto forzado por jugador de equipos especiales',
  'Special Teams Player Fumble Recovery': 'Balón suelto recuperado por jugador de equipos especiales',
  'Special Teams Player Solo Tackle': 'Tacleada en solitario de jugador de equipos especiales',
  'Player Punt Return Yards': 'Yardas de retorno de despeje del jugador',
  'Player Kick Return Yards': 'Yardas de retorno de patada del jugador',

  // ── Misc ──
  'Fumble': 'Balón suelto',
  'Fumble Lost': 'Balón suelto perdido',
  'Fumble Recovery TD': 'TD por balón suelto recuperado',

  // ── Bonus ──
  '100-199 Yard Rushing Game': 'Juego de 100-199 yardas por carrera',
  '200+ Yard Rushing Game': 'Juego de 200+ yardas por carrera',
  '100-199 Yard Receiving Game': 'Juego de 100-199 yardas por recepción',
  '200+ Yard Receiving Game': 'Juego de 200+ yardas por recepción',
  '300-399 Yard Passing Game': 'Juego de 300-399 yardas por pase',
  '400+ Yard Passing Game': 'Juego de 400+ yardas por pase',
  '100-199 Combined Rush + Rec Yards': '100-199 yardas combinadas de carrera + recepción',
  '200+ Combined Rush + Rec Yards': '200+ yardas combinadas de carrera + recepción',
  '25+ Pass Completions': '25+ pases completos',
  '20+ Carries': '20+ acarreos',
  '1st Down Bonus - RB': 'Bono por primer down - RB',
  '1st Down Bonus - WR': 'Bono por primer down - WR',
  '1st Down Bonus - TE': 'Bono por primer down - TE',
  '1st Down Bonus - QB': 'Bono por primer down - QB',

  // ── IDP ──
  'IDP TD': 'TD de IDP',
  'Sack': 'Captura',
  'Blocked Punt, PAT or FG': 'Despeje, PAT o FG bloqueado',
  'Interception': 'Intercepción',
  'Assisted Tackle': 'Tacleada asistida',
  '10+ Tackle Bonus': 'Bono por 10+ tacleadas',
  '2+ Sack Bonus': 'Bono por 2+ capturas',
  '3+ Pass Defended Bonus': 'Bono por 3+ pases defendidos',
  '50+ Yard INT Return TD Bonus': 'Bono por TD de retorno de intercepción de 50+ yardas',

  // ── Advanced (premium) ──
  'Air Yards': 'Yardas aéreas',
  'Completed Air Yards': 'Yardas aéreas completadas',
  'Receiving Air Yards': 'Yardas aéreas de recepción',
  'Passing Air Yards': 'Yardas aéreas de pase',
  'Explosive Play Bonus': 'Bono por jugada explosiva',
  'Yards After Contact': 'Yardas tras contacto',
  'Broken Tackles': 'Tacleadas evadidas',

  // ── Helpers ──
  '1 point every 25 yards (0.04 per yard)': '1 punto cada 25 yardas (0.04 por yarda)',
  '1 point every 10 yards (0.10 per yard)': '1 punto cada 10 yardas (0.10 por yarda)',
  '0.04 pts/yd (1 pt per 25 yds)': '0.04 pts/yd (1 pt cada 25 yd)',
  '0.10 pts/yd (1 pt per 10 yds)': '0.10 pts/yd (1 pt cada 10 yd)',
  'CFBD supplies total makes and attempts. Distance scoring is unavailable from this feed.':
    'CFBD solo da el total de aciertos e intentos. Esta fuente no permite puntuar por distancia.',
  '20+ yard play bonus': 'Bono por jugada de 20+ yardas',

  // ── Preset descriptions and warnings (served by the API from the preset registries) ──
  'Balanced 0.5 PPR NFL scoring optimized for AllFantasy league types.':
    'Puntuación NFL equilibrada con 0.5 PPR, optimizada para los tipos de liga de AllFantasy.',
  'AllFantasy scoring with 1 point per reception.': 'Puntuación AllFantasy con 1 punto por recepción.',
  'AllFantasy scoring with no points per reception.': 'Puntuación AllFantasy sin puntos por recepción.',
  'Sleeper standard PPR scoring: 1 PPR, 0.04/pass yd, 4 pass TD, 0.1/rush-rec yd, 6 rush/rec TD.':
    'Puntuación PPR estándar de Sleeper: 1 PPR, 0.04 por yarda de pase, 4 por TD de pase, 0.1 por yarda de carrera o recepción, 6 por TD de carrera o recepción.',
  "This preset is based on Sleeper's standard PPR format. Specialty leagues are optimized for AllFantasy scoring.":
    'Este preset se basa en el formato PPR estándar de Sleeper. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'ESPN Standard (non-PPR): 0 PPR, standard yardage and TD scoring.':
    'ESPN Estándar (sin PPR): 0 PPR, puntuación estándar por yardas y TD.',
  "This preset is based on ESPN's Standard format. Specialty leagues are optimized for AllFantasy scoring.":
    'Este preset se basa en el formato Estándar de ESPN. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'ESPN PPR: 1 point per reception, standard yardage and TD scoring.':
    'ESPN PPR: 1 punto por recepción, puntuación estándar por yardas y TD.',
  "This preset is based on ESPN's PPR format. Specialty leagues are optimized for AllFantasy scoring.":
    'Este preset se basa en el formato PPR de ESPN. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'Yahoo default: 0.5 PPR, fractional yardage, negative points.':
    'Predeterminado de Yahoo: 0.5 PPR, yardas fraccionadas, puntos negativos.',
  "This preset is based on Yahoo's default format. Specialty leagues are optimized for AllFantasy scoring.":
    'Este preset se basa en el formato predeterminado de Yahoo. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'Custom scoring values.': 'Valores de puntuación personalizados.',
  'Balanced NCAAF scoring with PPR and yardage bonuses, optimized for AllFantasy specialty leagues.':
    'Puntuación NCAAF equilibrada con PPR y bonos por yardas, optimizada para las ligas especiales de AllFantasy.',
  'Sleeper-compatible NCAAF scoring. Sleeper does not currently offer dedicated college football fantasy. This uses a Sleeper-style PPR structure.':
    'Puntuación NCAAF compatible con Sleeper. Sleeper no ofrece hoy fantasy de fútbol americano universitario, así que esto usa una estructura PPR al estilo de Sleeper.',
  'Sleeper does not currently support NCAAF fantasy leagues. This is a compatibility preset. Specialty leagues are optimized for AllFantasy scoring.':
    'Sleeper no admite hoy ligas fantasy de NCAAF. Este es un preset de compatibilidad. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'ESPN-compatible NCAAF scoring baseline.': 'Base de puntuación NCAAF compatible con ESPN.',
  'This preset is a compatible baseline for ESPN-style scoring. Specialty leagues are optimized for AllFantasy scoring.':
    'Este preset es una base compatible con la puntuación al estilo de ESPN. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'Yahoo-compatible NCAAF scoring baseline with 0.5 PPR.': 'Base de puntuación NCAAF compatible con Yahoo, con 0.5 PPR.',
  'This preset is a compatible baseline for Yahoo-style scoring. Specialty leagues are optimized for AllFantasy scoring.':
    'Este preset es una base compatible con la puntuación al estilo de Yahoo. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
}
