import { defineMessages } from '@/lib/i18n/messages'

/**
 * The /core/career guide (2026-11-14): the headline, the line under it, the intro, the "This season"
 * section heading, the folded survival scores and the merged level card
 * (lib/core-app/careerGuide.ts, components/core-app/career/CareerGuide.tsx).
 * Numbers arrive formatted, so a Spanish reader gets the same digits the page shows.
 */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

export const careerGuideMessages = defineMessages({
  en: {
    eyebrow: 'Your career',
    /** `t`/`p` are the counts (for one/many); `ts`/`ps` the same, formatted. */
    headTitles: (t: number, ts: string, p: number, ps: string, since: number | null) =>
      `${ts} ${plural(t, 'title', 'titles')}${p > 0 ? ` and ${ps} playoff ${plural(p, 'trip', 'trips')}` : ''}${since ? ` since ${since}` : ''}`,
    headPlayoffs: (p: number, ps: string, since: number | null) =>
      `No titles yet — ${ps} playoff ${plural(p, 'trip', 'trips')}${since ? ` since ${since}` : ''}`,
    headRecord: (winPct: number | null, since: number | null) =>
      winPct == null ? 'No titles yet' : `No titles yet — ${winPct}% of games won${since ? ` since ${since}` : ''}`,
    headEmpty: 'No finished seasons yet',
    headFiltered: 'Nothing matches these filters',
    level: (level: number, name: string | null) => (name ? `Level ${level} ${name}` : `Level ${level}`),
    leagueSeasons: (n: string, sports: number) =>
      `${n} league-seasons${sports > 1 ? ` across ${sports} sports` : ''}`,
    totalsAsOf: (when: string) => `totals as of ${when}`,
    intro: 'Every season you’ve finished, across every league you’ve imported. Leagues still being played count once they end.',
    thisSeason: 'This season',
    thisSeasonNote: 'Every league you’re playing now — not narrowed by the filter.',
    survival: 'Survival scores',
    survivalSummary: (n: number, best: string | null) =>
      `${n} elimination ${plural(n, 'season', 'seasons')}${best ? ` · best ${best}` : ''}`,
    xpLine: (xp: string, toNext: string | null, next: string | null) =>
      toNext != null && next ? `${xp} XP · ${toNext} XP to ${next}` : `${xp} XP`,
    shareCard: 'Share card',
    shareAnother: 'Share a card',
  },
  es: {
    eyebrow: 'Tu carrera',
    headTitles: (t, ts, p, ps, since) =>
      `${ts} ${plural(t, 'título', 'títulos')}${p > 0 ? ` y ${ps} ${plural(p, 'presencia', 'presencias')} en playoffs` : ''}${since ? ` desde ${since}` : ''}`,
    headPlayoffs: (p, ps, since) =>
      `Aún sin títulos: ${ps} ${plural(p, 'presencia', 'presencias')} en playoffs${since ? ` desde ${since}` : ''}`,
    headRecord: (winPct, since) =>
      winPct == null ? 'Aún sin títulos' : `Aún sin títulos: ${winPct}% de partidos ganados${since ? ` desde ${since}` : ''}`,
    headEmpty: 'Aún no hay temporadas terminadas',
    headFiltered: 'Nada coincide con estos filtros',
    level: (level, name) => (name ? `Nivel ${level} ${name}` : `Nivel ${level}`),
    leagueSeasons: (n, sports) => `${n} temporadas de liga${sports > 1 ? ` en ${sports} deportes` : ''}`,
    totalsAsOf: (when) => `totales al ${when}`,
    intro: 'Cada temporada que has terminado, en todas las ligas que has importado. Las ligas que aún se juegan cuentan cuando terminan.',
    thisSeason: 'Esta temporada',
    thisSeasonNote: 'Todas las ligas que juegas ahora, sin el filtro.',
    survival: 'Puntuaciones de supervivencia',
    survivalSummary: (n, best) => `${n} ${plural(n, 'temporada', 'temporadas')} de eliminación${best ? ` · mejor ${best}` : ''}`,
    xpLine: (xp, toNext, next) => (toNext != null && next ? `${xp} XP · ${toNext} XP para ${next}` : `${xp} XP`),
    shareCard: 'Compartir tarjeta',
    shareAnother: 'Compartir otra tarjeta',
  },
})
