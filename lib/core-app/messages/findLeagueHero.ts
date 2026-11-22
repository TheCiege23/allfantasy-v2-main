import { defineMessages } from '@/lib/i18n/messages'

/**
 * The Find a League header (components/find-league/FindLeagueHero.tsx). Since 2026-11-14 the title says
 * what to do and the intro says how, instead of listing every filter by name. The Career Level rule that
 * sat in its own box below is one sentence under it (lib/core-app/messages/findLeagueGuide.ts).
 */
export const findLeagueHeroMessages = defineMessages({
  en: {
    home: '← Home',
    eyebrow: 'Public leagues · every sport',
    title: 'Find a league to join',
    intro: 'Pick a league with an open seat and press Join.',
  },
  es: {
    home: '← Inicio',
    eyebrow: 'Ligas públicas · todos los deportes',
    title: 'Encuentra una liga para unirte',
    intro: 'Elige una liga con una plaza libre y pulsa Unirse.',
  },
})
