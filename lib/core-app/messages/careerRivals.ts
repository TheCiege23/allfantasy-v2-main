import { defineMessages } from '@/lib/i18n/messages'

/** Career → overview "Your rivals" card (components/core-app/career/CareerRivalsCard.tsx). */
export const careerRivalsMessages = defineMessages({
  en: {
    title: 'Your rivals',
    note: 'The managers you have played most, every league and season on file.',
    meetings: (n: number) => `${n} ${n === 1 ? 'game' : 'games'}`,
    record: 'Record',
    seasons: (first: number, last: number) => (first === last ? `${first}` : `${first}–${last}`),
    ledger: 'Full rivalry ledger →',
  },
  es: {
    title: 'Tus rivales',
    note: 'Los mánagers contra los que más has jugado, en todas las ligas y temporadas registradas.',
    meetings: (n) => `${n} ${n === 1 ? 'partido' : 'partidos'}`,
    record: 'Récord',
    seasons: (first, last) => (first === last ? `${first}` : `${first}–${last}`),
    ledger: 'Historial completo de rivalidades →',
  },
})
