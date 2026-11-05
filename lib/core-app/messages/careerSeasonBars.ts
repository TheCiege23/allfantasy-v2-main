import { defineMessages } from '@/lib/i18n/messages'

/** Career → Season by season (components/core-app/career/SeasonBars.tsx). */
export const careerSeasonBarsMessages = defineMessages({
  en: {
    title: 'Season by season',
    note: 'Regular-season win rate each year. A star marks a year you won a title.',
    axisTop: '100%',
    axisMid: '50%',
    axisBottom: '0%',
    noGames: 'no games',
    bestYear: (season: number, pct: number) => `Best: ${season} at ${pct}%`,
    barLabel: (season: number, record: string, pct: number | null, titles: number) =>
      `${season}: ${record}${pct == null ? ', no games' : `, ${pct}% win rate`}${
        titles > 0 ? `, ${titles} ${titles === 1 ? 'title' : 'titles'}` : ''
      }`,
  },
  es: {
    title: 'Temporada a temporada',
    note: 'Porcentaje de victorias de temporada regular cada año. Una estrella marca un año con título.',
    axisTop: '100%',
    axisMid: '50%',
    axisBottom: '0%',
    noGames: 'sin partidos',
    bestYear: (season, pct) => `Mejor: ${season} con ${pct}%`,
    barLabel: (season, record, pct, titles) =>
      `${season}: ${record}${pct == null ? ', sin partidos' : `, ${pct}% de victorias`}${
        titles > 0 ? `, ${titles} ${titles === 1 ? 'título' : 'títulos'}` : ''
      }`,
  },
})
