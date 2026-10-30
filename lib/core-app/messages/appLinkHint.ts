import { defineMessages } from '@/lib/i18n/messages'

/**
 * The line under a platform button (components/core-app/player-finder/AppLinkHint.tsx), built by
 * `appLinkHint` in lib/core-app/nativeApp.ts. Every string is the one that function returned before
 * the move, byte for byte, in both languages — a relocation, not a rewrite. `name` is the platform's
 * display name ("Yahoo", "ESPN").
 */
export const appLinkHintMessages = defineMessages({
  en: {
    opensInApp: (name: string) => `Opens in the ${name} app when it’s installed`,
    mayOpenApp: (name: string) => `May open the ${name} app`,
    webSleeperIos: (name: string) => `Opens ${name} on the web — its app does not take league links on iPhone`,
    web: (name: string) => `Opens ${name} on the web`,
  },
  es: {
    opensInApp: (name) => `Se abre en la app de ${name} si la tienes instalada`,
    mayOpenApp: (name) => `Puede abrirse en la app de ${name}`,
    webSleeperIos: (name) => `Abre ${name} en la web: su app no acepta enlaces de ligas en iPhone`,
    web: (name) => `Abre ${name} en la web`,
  },
})
