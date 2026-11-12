import { defineMessages } from '@/lib/i18n/messages'

/**
 * War Room phase 6 — the war chest (components/core-app/screens/WarChest.tsx).
 *
 * ⚠ BALANCES ARE FACTS. Nobody is called broke or a hoarder; an unrecorded balance says so rather than
 * reading as $0. The only advice is the redraft use-it-or-lose-it arithmetic about YOUR wallet.
 */
export const warRoomWarChestMessages = defineMessages({
  en: {
    heading: 'War chest',
    you: (amount: string, budget: string | null, rank: number, of: number) =>
      `You have ${amount}${budget ? ` of ${budget}` : ''} in FAAB — ${rank === 1 ? 'the most' : `${ordinal(rank)} most`} of the ${of} teams with a recorded balance.`,
    youUnknown: 'Your FAAB balance isn’t recorded for this league.',
    useIt: (weeks: number) =>
      `This is a redraft league, so FAAB left when the season ends buys nothing — and ${weeks === 0 ? 'the regular season is over' : `${weeks} regular-season ${weeks === 1 ? 'week is' : 'weeks are'} left`}.`,
    unknown: 'not recorded',
    youLabel: 'You',
    notRead: 'FAAB balances aren’t recorded for this league.',
    basis: 'Balances as last synced from your league.',
  },
  es: {
    heading: 'Fondo de guerra',
    you: (amount, budget, rank, of) =>
      `Tienes ${amount}${budget ? ` de ${budget}` : ''} de FAAB — ${rank === 1 ? 'el que más tiene' : `el ${rank}.º que más tiene`} de los ${of} equipos con saldo registrado.`,
    youUnknown: 'Tu saldo de FAAB no está registrado en esta liga.',
    useIt: (weeks) =>
      `Es una liga redraft, así que el FAAB que quede al terminar la temporada no compra nada — y ${weeks === 0 ? 'la temporada regular ya terminó' : weeks === 1 ? 'queda 1 semana de temporada regular' : `quedan ${weeks} semanas de temporada regular`}.`,
    unknown: 'sin registro',
    youLabel: 'Tú',
    notRead: 'Los saldos de FAAB no están registrados en esta liga.',
    basis: 'Saldos según la última sincronización de tu liga.',
  },
})

function ordinal(n: number): string {
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}
