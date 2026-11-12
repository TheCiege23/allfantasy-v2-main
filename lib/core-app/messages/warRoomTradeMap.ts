import { defineMessages } from '@/lib/i18n/messages'

/**
 * War Room phase 6 — the trade map, inside the trade ideas (components/core-app/screens/WarTradeIdeas.tsx).
 *
 * ⚠ MEASUREMENTS, NEVER LABELS. "A bench WR projecting 14.2", "their RBs start 4.0 under the league
 * average" — never "they need a RB badly" or "a seller". The reader draws the conclusion.
 */
export const warRoomTradeMapMessages = defineMessages({
  en: {
    heading: 'Trade map',
    lead: (week: number | null) =>
      `Teams deep where you’re thin, and thin where you’re deep, on ${week == null ? 'this week’s' : `week ${week}`} projections. A place to start a conversation — the ideas above are the ones priced in odds.`,
    theyHave: (pos: string, name: string, pts: string, up: string) =>
      `Has ${name} (${pos}, ${pts}) on the bench — ${up} over your weakest ${pos} starter.`,
    theyNeed: (pos: string, under: string, name: string, up: string) =>
      `Their ${pos} starters average ${under} under the league; your bench ${pos} ${name} would start for them (${up}).`,
    more: (n: number) => `${n} more ${n === 1 ? 'team fits' : 'teams fit'}.`,
    none: 'No team has a bench player who would start for you, or a thin spot your bench could fill.',
  },
  es: {
    heading: 'Mapa de cambios',
    lead: (week) =>
      `Equipos con profundidad donde tú estás corto, y cortos donde tú tienes profundidad, con las proyecciones de ${week == null ? 'esta semana' : `la semana ${week}`}. Un punto de partida para negociar — las ideas de arriba son las que se calculan en probabilidades.`,
    theyHave: (pos, name, pts, up) => `Tiene a ${name} (${pos}, ${pts}) en la banca — ${up} sobre tu titular ${pos} más débil.`,
    theyNeed: (pos, under, name, up) =>
      `Sus titulares ${pos} promedian ${under} por debajo de la liga; tu ${pos} de banca ${name} sería titular para ellos (${up}).`,
    more: (n) => (n === 1 ? '1 equipo más encaja.' : `${n} equipos más encajan.`),
    none: 'Ningún equipo tiene un jugador de banca que sería titular para ti, ni un hueco que tu banca pueda llenar.',
  },
})
