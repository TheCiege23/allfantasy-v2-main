import { defineMessages } from '@/lib/i18n/messages'

/**
 * Defense Hub (app/idp/defense-hub/[leagueId]/DefenseHubClient.tsx) — the screen's own fixed copy:
 * the header, its three figures, the coverage note, section headings and column heads. Server notes
 * and the per-state explanations still arrive in English from the loader.
 *
 * "Defense Hub" keeps the shell's Spanish nav name («Defensa», lib/core-app/coreUiCopy.ts) so the
 * rail and the page title agree.
 */
export const defenseHubMessages = defineMessages({
  en: {
    eyebrow: 'Individual defenders',
    title: 'Defense Hub',
    lede: 'If a number can’t be traced to a real stat line, it doesn’t render — this page shows an absence, never a guess.',
    backToLeague: '← League',
    loading: 'Loading…',
    notMember: 'You don’t have access to this league.',
    loadFailed: 'We couldn’t load this page. Nothing is shown rather than something wrong.',
    statRostered: 'Defenders rostered',
    statProjected: 'Projected',
    statPriced: 'Priced league-wide',
    coverage: 'Coverage',
    coverageLine: (projected: number, total: number) => `${projected} of ${total} rostered defenders projected`,
    coverageFrom: (season: number, week: number) => ` from games through ${season} week ${week}`,
    coveragePriced: (projected: number, defenders: number) => ` · ${projected} of ${defenders} defenders priced league-wide.`,
    yourDefenders: 'Your rostered defenders',
    yourDefendersSub: 'Projected under this league’s own scoring, sorted by projection.',
    colPlayer: 'Player',
    colPos: 'Pos',
    colProj: 'Proj ↓',
    colLastWeek: 'Last wk',
    colVorp: 'VORP',
    colPosRank: 'Pos rank',
    colValue: 'Value',
    floor: 'floor',
    yourKickers: 'Your kickers',
    snapShare: 'Snap share',
    roles: 'What they actually do',
    tendencies: 'How their defence has been played',
  },
  es: {
    eyebrow: 'Defensores individuales',
    title: 'Defensa',
    lede: 'Si un número no se puede rastrear hasta una línea estadística real, no aparece: esta página muestra una ausencia, nunca una suposición.',
    backToLeague: '← Liga',
    loading: 'Cargando…',
    notMember: 'No tienes acceso a esta liga.',
    loadFailed: 'No pudimos cargar esta página. No mostramos nada antes que algo incorrecto.',
    statRostered: 'Defensores en plantilla',
    statProjected: 'Proyectados',
    statPriced: 'Valorados en la liga',
    coverage: 'Cobertura',
    coverageLine: (projected, total) => `${projected} de ${total} defensores en plantilla proyectados`,
    coverageFrom: (season, week) => ` con partidos hasta la semana ${week} de ${season}`,
    coveragePriced: (projected, defenders) => ` · ${projected} de ${defenders} defensores valorados en toda la liga.`,
    yourDefenders: 'Tus defensores en plantilla',
    yourDefendersSub: 'Proyectados con la puntuación de esta liga, ordenados por proyección.',
    colPlayer: 'Jugador',
    colPos: 'Pos',
    colProj: 'Proy ↓',
    colLastWeek: 'Sem. ant.',
    colVorp: 'VORP',
    colPosRank: 'Rango pos',
    colValue: 'Valor',
    floor: 'mínimo',
    yourKickers: 'Tus pateadores',
    snapShare: 'Porcentaje de snaps',
    roles: 'Lo que hacen en realidad',
    tendencies: 'Cómo han jugado contra su defensa',
  },
})
