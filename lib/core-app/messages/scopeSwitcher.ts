import { defineMessages } from '@/lib/i18n/messages'

/**
 * The scope switcher (components/core-app/ScopeSwitcher.tsx). Every string is the one the switcher
 * printed before the move, byte for byte, in both languages — this is a relocation, not a rewrite.
 * A league's OWN name is never translated; scope labels still go through `scopeLabelText`.
 */
export const scopeSwitcherMessages = defineMessages({
  en: {
    sport: 'Sport',
    platform: 'Platform',
    kickerLeague: 'League',
    kickerViewing: 'Viewing',
    viewingSr: 'Viewing: ',
    closePicker: 'Close league picker',
    chooseLeagues: 'Choose which leagues to view',
    whichLeagues: 'Which leagues?',
    scope: 'Scope',
    starToUse: 'Star a league below to use this',
    favorites: 'Favorites',
    findLeague: 'Find a league',
    findPlaceholder: 'Find a league, sport or platform',
    leagues: 'Leagues',
    noLeagueMatches: 'No league matches',
    starLabel: (starred: boolean, name: string) => `${starred ? 'Remove' : 'Add'} ${name} ${starred ? 'from' : 'to'} favorites`,
    favoritesNote: 'Favorites are saved on this device.',
  },
  es: {
    sport: 'Deporte',
    platform: 'Plataforma',
    kickerLeague: 'Liga',
    kickerViewing: 'Viendo',
    viewingSr: 'Viendo: ',
    closePicker: 'Cerrar el selector de ligas',
    chooseLeagues: 'Elige qué ligas ver',
    whichLeagues: '¿Qué ligas?',
    scope: 'Alcance',
    starToUse: 'Marca una liga con la estrella para usar esto',
    favorites: 'Favoritas',
    findLeague: 'Busca una liga',
    findPlaceholder: 'Busca una liga, deporte o plataforma',
    leagues: 'Ligas',
    noLeagueMatches: 'Ninguna liga coincide con',
    starLabel: (starred, name) => `${starred ? 'Quitar' : 'Añadir'} ${name} ${starred ? 'de' : 'a'} favoritas`,
    favoritesNote: 'Las favoritas se guardan en este dispositivo.',
  },
})
