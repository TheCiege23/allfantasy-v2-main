import { defineMessages } from '@/lib/i18n/messages'

/**
 * The home's latest-trades band (components/core-app/screens/DashTradeBandView.tsx). Every string is
 * the one the band printed before the move, byte for byte, in both languages — a relocation, not a
 * rewrite.
 */
export const dashTradeBandMessages = defineMessages({
  en: {
    title: 'Trades',
    countLast24h: (n: number) => `${n} in the last 24h`,
    last24h: 'last 24h',
    noTrades24h: 'No trades in the last 24 hours.',
    lastOneIn: (league: string) => `Last one was in ${league}`,
    seeTrades: 'See trades',
    verdictEven: 'An even deal on paper',
    verdictUnnamed: 'One side comes out ahead',
    favours: (strongly: boolean, who: string) => `${strongly ? 'Clearly favours' : 'Slightly favours'} ${who}`,
    basisLeague: 'League grade',
    basisWithheld: 'Contextual grade withheld',
    basisOther: (basis: string): string => basis,
    grade: 'Grade',
    received: 'Received',
    gets: 'Gets',
    more: (n: number) => `+${n} more`,
    faabOnly: 'FAAB only, or not captured',
    onLeagueValues: 'on this league’s values',
    confidence: (n: number) => ` · ${n}% confidence`,
    whyGrades: 'Why these grades',
    whyLocked: (plan: string) => `Why these grades · ${plan}`,
    allTrades: (league: string) => `All ${league} trades`,
    /** A side's grade line: the loader's English, or (Spanish) its rebuild when there is one. */
    gradeReason: (reason: string, _rebuilt: string | null): string => reason,
  },
  es: {
    title: 'Intercambios',
    countLast24h: (n) => `${n} en las últimas 24 h`,
    last24h: 'últimas 24 h',
    noTrades24h: 'Sin intercambios en las últimas 24 horas.',
    lastOneIn: (league) => `El último fue en ${league}`,
    seeTrades: 'Ver intercambios',
    verdictEven: 'Un intercambio equilibrado sobre el papel',
    verdictUnnamed: 'Un lado sale ganando',
    favours: (strongly, who) => `${strongly ? 'Favorece claramente a' : 'Favorece ligeramente a'} ${who}`,
    basisLeague: 'Calificación de liga',
    basisWithheld: 'Calificación contextual no disponible',
    basisOther: (basis) => (basis === 'Market' ? 'Mercado' : 'Real'),
    grade: 'Calificación',
    received: 'Recibió',
    gets: 'Recibe',
    more: (n) => `+${n} más`,
    faabOnly: 'Solo FAAB, o no se capturó',
    onLeagueValues: 'con los valores de esta liga',
    confidence: (n) => ` · ${n}% de confianza`,
    whyGrades: 'Por qué estas calificaciones',
    whyLocked: (plan) => `Por qué estas calificaciones · ${plan}`,
    allTrades: (league) => `Todos los intercambios de ${league}`,
    gradeReason: (reason, rebuilt) => rebuilt ?? reason,
  },
})
