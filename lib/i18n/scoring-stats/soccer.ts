/**
 * lib/i18n/scoring-stats/soccer.ts — Spanish for the soccer scoring editor.
 *
 * Keyed by the exact English in `lib/soccer-scoring/SoccerScoringCategories.ts` and the soccer
 * preset registry (whose descriptions and warnings reach the editor through the API). Metric
 * abbreviations (xG, xA, xGI, PSxG, SCA, FPL, MOTM) stay as the game writes them.
 */

import type { StatTable } from './index'

export const SOCCER_STATS_ES: StatTable = {
  // ── Categories ──
  'Outfield': 'Jugadores de campo',
  'Goalkeeping': 'Portería',
  'Discipline': 'Disciplina',
  'Bonuses': 'Bonos',
  'Misc': 'Varios',
  'Advanced': 'Avanzado',

  // ── Outfield ──
  'Goal': 'Gol',
  'Assist': 'Asistencia',
  'Shot on Target': 'Tiro a puerta',
  'Shot (any)': 'Tiro (cualquiera)',
  'Key Pass': 'Pase clave',
  'Big Chance Created': 'Ocasión clara creada',
  'Through Ball': 'Pase en profundidad',
  'Successful Dribble': 'Regate exitoso',
  'Accurate Cross': 'Centro preciso',
  'Penalty Scored': 'Penal anotado',
  'Penalty Missed': 'Penal fallado',
  'Clean Sheet (DEF/MID)': 'Portería a cero (DEF/MED)',
  'Goal Conceded': 'Gol recibido',
  'Tackle Won': 'Entrada ganada',
  'Interception': 'Intercepción',
  'Clearance': 'Despeje',
  'Blocked Shot': 'Tiro bloqueado',
  'Aerial Duel Won': 'Duelo aéreo ganado',
  'Own Goal': 'Gol en propia puerta',

  // ── Goalkeeping ──
  'Save': 'Atajada',
  'Penalty Save': 'Penal atajado',
  'Goal Conceded (GK)': 'Gol recibido (POR)',
  'Clean Sheet (GK)': 'Portería a cero (POR)',
  'High Claim': 'Balón alto atrapado',
  'Punch / Claim': 'Despeje de puños / atrapada',
  'Save Inside the Box': 'Atajada dentro del área',

  // ── Discipline ──
  'Yellow Card': 'Tarjeta amarilla',
  'Red Card': 'Tarjeta roja',
  'Foul Committed': 'Falta cometida',
  'Foul Drawn': 'Falta recibida',
  'Offside': 'Fuera de juego',

  // ── Bonuses ──
  'Hat Trick Bonus': 'Bono por hat trick',
  'Man of the Match': 'Jugador del partido',
  'Rating 7.0+ Bonus': 'Bono por calificación 7.0+',
  'Rating 8.0+ Bonus': 'Bono por calificación 8.0+',

  // ── Misc ──
  'Minutes Played': 'Minutos jugados',
  'Appearance Bonus': 'Bono por aparición',
  'Substitute On': 'Entra como suplente',
  'Substitute Off': 'Sustituido',

  // ── Advanced (premium) ──
  'xG Bonus': 'Bono por xG',
  'xA Bonus': 'Bono por xA',
  'xGI Bonus': 'Bono por xGI',
  'Post-Shot xG': 'xG posterior al tiro',
  'Progressive Pass': 'Pase progresivo',
  'Progressive Carry': 'Conducción progresiva',
  'Shot-Creating Action (SCA)': 'Acción que crea un tiro (SCA)',
  'GK Post-Shot xG Saved (PSxG)': 'xG posterior al tiro atajado por el POR (PSxG)',

  // ── Helpers ──
  'Excludes goals': 'Sin contar los goles',
  'All shots taken': 'Todos los tiros realizados',
  'Pass leading to a shot': 'Pase que termina en tiro',
  'Clear goal-scoring opportunity created': 'Ocasión clara de gol creada',
  'Completed take-on': 'Regate completado',
  'On top of goal value': 'Sumado al valor del gol',
  'Outfield player 0 GA at 60+ min': 'Jugador de campo sin goles en contra con 60+ min',
  'Per goal while outfield player is on pitch': 'Por gol recibido mientras el jugador de campo está en la cancha',
  'Per goal let in': 'Por gol recibido',
  'Claiming a high ball': 'Atrapar un balón alto',
  'Successfully punching a cross': 'Despejar de puños un centro con éxito',
  'Difficult close-range save': 'Atajada difícil a corta distancia',
  'Automatic suspension': 'Suspensión automática',
  'Extra points for 3+ goals in a match': 'Puntos extra por 3+ goles en un partido',
  'AFC MOTM award': 'Premio MOTM de AFC',
  'Whoscored / Sofascore match rating ≥7.0': 'Calificación del partido en Whoscored / Sofascore ≥7.0',
  'Whoscored / Sofascore match rating ≥8.0': 'Calificación del partido en Whoscored / Sofascore ≥8.0',
  'Per minute on pitch': 'Por minuto en la cancha',
  'Flat points for any appearance': 'Puntos fijos por cualquier aparición',
  'Flat bonus for coming on as sub': 'Bono fijo por entrar como suplente',
  'Flat modifier for being substituted off': 'Ajuste fijo por ser sustituido',
  'Points per expected goal (xG) produced': 'Puntos por gol esperado (xG) generado',
  'Points per expected assist (xA)': 'Puntos por asistencia esperada (xA)',
  'Points per xG + xA (goal involvement)': 'Puntos por xG + xA (participación en gol)',
  'Shot quality metric — actual shot xG': 'Métrica de calidad del tiro: xG del tiro real',
  'Pass that moves the ball significantly toward goal': 'Pase que acerca mucho el balón a la portería',
  'Ball carry significantly toward opponent goal': 'Conducción que acerca mucho el balón a la portería rival',
  'Any action leading directly to a shot': 'Cualquier acción que lleva directamente a un tiro',
  'GK performance vs. quality of shots faced': 'Rendimiento del portero frente a la calidad de los tiros recibidos',

  // ── Preset descriptions and warnings (served by the API from the preset registry) ──
  'Balanced soccer scoring optimized for AllFantasy league types. Rewards goals, assists, clean sheets, and defensive contributions.':
    'Puntuación de fútbol equilibrada, optimizada para los tipos de liga de AllFantasy. Premia goles, asistencias, porterías a cero y aportes defensivos.',
  "Fantasy Premier League compatible scoring. Based on FPL's well-known points structure with position-agnostic point values.":
    'Puntuación compatible con Fantasy Premier League. Se basa en la conocida estructura de puntos de FPL, con valores iguales para todas las posiciones.',
  'This preset is based on FPL scoring conventions. FPL awards different goal points by position (GK/DEF=6, MID=5, FWD=4) which is simplified here. Specialty leagues are optimized for AllFantasy scoring.':
    'Este preset se basa en las convenciones de puntuación de FPL. FPL da distintos puntos por gol según la posición (POR/DEF=6, MED=5, DEL=4), algo que aquí se simplifica. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'ESPN-compatible soccer scoring baseline for points leagues.': 'Base de puntuación de fútbol compatible con ESPN para ligas de puntos.',
  'ESPN offers limited soccer fantasy support. This is a compatible baseline. Specialty leagues are optimized for AllFantasy scoring.':
    'ESPN ofrece un soporte limitado para el fantasy de fútbol. Esta es una base compatible. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'Yahoo-compatible soccer scoring baseline.': 'Base de puntuación de fútbol compatible con Yahoo.',
  'Yahoo offers limited soccer fantasy support. This is a compatible baseline. Specialty leagues are optimized for AllFantasy scoring.':
    'Yahoo ofrece un soporte limitado para el fantasy de fútbol. Esta es una base compatible. Las ligas especiales están optimizadas para la puntuación de AllFantasy.',
  'Custom scoring values.': 'Valores de puntuación personalizados.',
}
