import { defineMessages } from '@/lib/i18n/messages'

/**
 * Game day band (components/core-app/screens/DashGameDayBandView.tsx). Every string is the one the
 * band printed before the move, byte for byte, in both languages — this is a relocation, not a rewrite.
 * A play rebuilt from `actionParts` and a betting line rebuilt from `oddsParts` still go through
 * `homeBandsCopy`; only the band's own fixed words live here.
 *
 * `playHeadline`, `gameSub` and `odds` are handed the loader's English and return it unchanged in
 * English; Spanish uses the rebuild the view hands alongside it, and keeps the English whole when
 * there is none.
 */
export const dashGameDayBandMessages = defineMessages({
  en: {
    title: 'Game day',
    ahead: (wins: number) => `${wins} ahead`,
    behind: (losses: number) => `${losses} behind`,
    rightNowWeek: (week: number) => `right now · week ${week}`,
    noneScored: 'none of your matchups have scored yet',
    everyScoringPlay: 'Every NFL scoring play — not only your players',
    /** TD, FG and their DEF / ST forms are what a Spanish-language broadcast prints too; these two words are not. */
    typeBigPlay: 'BIG',
    typeTurnover: 'TO',
    play: 'PLAY',
    next24: 'Next 24 hours · betting lines',
    at: 'at',
    startsIn: 'Starts in',
    liveScoring: 'Live scoring →',
    playHeadline: (headline: string, _player: string, _action: string | null): string => headline,
    gameSub: (sub: string, _sport: string, _week: number | null): string => sub,
    odds: (odds: string, _rebuilt: string | null): string => odds,
  },
  es: {
    title: 'Día de partido',
    ahead: (wins) => `${wins} por delante`,
    behind: (losses) => `${losses} por detrás`,
    rightNowWeek: (week) => `ahora mismo · semana ${week}`,
    noneScored: 'ninguno de tus enfrentamientos ha sumado puntos todavía',
    everyScoringPlay: 'Todas las jugadas de anotación de la NFL, no solo las de tus jugadores',
    typeBigPlay: 'GRAN',
    typeTurnover: 'PÉRD',
    play: 'JUGADA',
    next24: 'Próximas 24 horas · líneas de apuestas',
    /** ESPN Deportes' convention: the away side "en" the home side. */
    at: 'en',
    startsIn: 'Empieza en',
    liveScoring: 'Puntuación en vivo →',
    playHeadline: (headline, player, action) => (action ? `${player} ${action}` : headline),
    gameSub: (_sub, sport, week) => [sport, week != null ? `Semana ${week}` : null].filter(Boolean).join(' · '),
    odds: (odds, rebuilt) => rebuilt ?? odds,
  },
})

export type DashGameDayBandMessages = typeof dashGameDayBandMessages.en
