/**
 * English + Spanish copy for games limits (lib/redraft/gamesLimits.ts): the commissioner panel and the
 * matchup indicator. Kept beside the feature, like the other two-language strings on matchup screens,
 * so the shared translation table is not a merge point for it.
 */

export type GamesLimitsCopy = {
  title: string
  subtitle: string
  needsDaily: string
  capsLabel: string
  capsHelp: string
  capPlaceholder: string
  goalieLabel: string
  goalieHelp: string
  inningsMinLabel: string
  inningsMinHelp: string
  inningsMaxLabel: string
  inningsMaxHelp: string
  off: string
  /** "{slot}: {used} of {cap} games used" */
  capUsage: (slot: string, used: number, cap: number) => string
  goalieUsage: (count: number, min: number, met: boolean) => string
  inningsUsage: (innings: string, min: string | null, max: string | null, minMet: boolean | undefined, maxReached: boolean | undefined) => string
  indicatorTitle: string
}

const EN: GamesLimitsCopy = {
  title: 'Games limits',
  subtitle: 'Optional caps and minimums, applied to daily-lineup scoring. All off by default.',
  needsDaily: 'These limits need daily lineups, which are not on for this league yet.',
  capsLabel: 'Games-played caps (per lineup slot, season)',
  capsHelp:
    'Maximum games each lineup seat can count for the season — two G seats with a cap of 82 allow 164 games. The day a slot reaches its cap counts in full; after that, that slot scores 0. Leave blank for no cap.',
  capPlaceholder: 'No cap',
  goalieLabel: 'Goalie minimum (games per week)',
  goalieHelp: 'If your starting goalies play fewer games in a week, that week’s goalie points score 0.',
  inningsMinLabel: 'Innings minimum (per week)',
  inningsMinHelp:
    'If your starting pitchers throw fewer innings, pitching points score 0 that week (category leagues: ERA and WHIP do not qualify).',
  inningsMaxLabel: 'Innings maximum (per week)',
  inningsMaxHelp: 'Once the maximum is reached, pitching from later days does not count. The day that reaches it counts in full.',
  off: 'Off',
  capUsage: (slot, used, cap) => `${slot}: ${used} of ${cap} games used`,
  goalieUsage: (count, min, met) => `Goalie starts ${count} of ${min}${met ? '' : ' — below the minimum, goalie points not counting'}`,
  inningsUsage: (innings, min, max, minMet, maxReached) =>
    [
      `Innings ${innings}`,
      min ? `min ${min}${minMet === false ? ' (not met — pitching not counting)' : ''}` : null,
      max ? `max ${max}${maxReached ? ' (reached)' : ''}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  indicatorTitle: 'Games limits',
}

const ES: GamesLimitsCopy = {
  title: 'Límites de partidos',
  subtitle: 'Topes y mínimos opcionales para la puntuación con alineaciones diarias. Todos desactivados por defecto.',
  needsDaily: 'Estos límites requieren alineaciones diarias, que aún no están activas en esta liga.',
  capsLabel: 'Tope de partidos jugados (por puesto de alineación, temporada)',
  capsHelp:
    'Máximo de partidos que cuenta cada puesto en la temporada: dos puestos G con un tope de 82 permiten 164 partidos. El día en que un puesto alcanza su tope cuenta completo; después, ese puesto suma 0. Déjalo en blanco para no tener tope.',
  capPlaceholder: 'Sin tope',
  goalieLabel: 'Mínimo de porteros (partidos por semana)',
  goalieHelp: 'Si tus porteros titulares juegan menos partidos en la semana, sus puntos de esa semana valen 0.',
  inningsMinLabel: 'Mínimo de entradas (por semana)',
  inningsMinHelp:
    'Si tus lanzadores titulares lanzan menos entradas, los puntos de pitcheo valen 0 esa semana (ligas por categorías: ERA y WHIP no califican).',
  inningsMaxLabel: 'Máximo de entradas (por semana)',
  inningsMaxHelp: 'Al alcanzar el máximo, el pitcheo de los días siguientes no cuenta. El día en que se alcanza cuenta completo.',
  off: 'Desactivado',
  capUsage: (slot, used, cap) => `${slot}: ${used} de ${cap} partidos usados`,
  goalieUsage: (count, min, met) =>
    `Porteros titulares ${count} de ${min}${met ? '' : ' — por debajo del mínimo, sus puntos no cuentan'}`,
  inningsUsage: (innings, min, max, minMet, maxReached) =>
    [
      `Entradas ${innings}`,
      min ? `mín. ${min}${minMet === false ? ' (no alcanzado — el pitcheo no cuenta)' : ''}` : null,
      max ? `máx. ${max}${maxReached ? ' (alcanzado)' : ''}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  indicatorTitle: 'Límites de partidos',
}

export function gamesLimitsCopy(language: string | null | undefined): GamesLimitsCopy {
  return language === 'es' ? ES : EN
}

/** Outs → baseball innings notation: 61 outs → "20.1". */
export function inningsFromOuts(outs: number): string {
  const whole = Math.floor(outs / 3)
  const rest = outs - whole * 3
  return rest ? `${whole}.${rest}` : String(whole)
}
