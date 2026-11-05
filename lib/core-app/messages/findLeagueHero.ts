import { defineMessages } from '@/lib/i18n/messages'

/**
 * The Find a League header (components/find-league/FindLeagueHero.tsx), restyled to the Find a
 * League board (2026-11-05). Only the header moved into a catalog; the filters and cards below it
 * keep their existing copy.
 */
export const findLeagueHeroMessages = defineMessages({
  en: {
    home: '← Home',
    eyebrow: 'Public leagues · every sport',
    title: 'Find a league',
    intro:
      'Discover leagues across all supported sports. Filter by sport, league type, draft type, team count, entry fee, and more. Join with one click.',
  },
  es: {
    home: '← Inicio',
    eyebrow: 'Ligas públicas · todos los deportes',
    title: 'Encuentra una liga',
    intro:
      'Descubre ligas de todos los deportes disponibles. Filtra por deporte, tipo de liga, tipo de draft, número de equipos, cuota de inscripción y más. Únete con un clic.',
  },
})
