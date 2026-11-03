import { defineMessages } from '@/lib/i18n/messages'

/**
 * The in-context push ask (components/core-app/player-finder/PushAsk.tsx, via
 * lib/core-app/pushAskCopy.ts). Every string is the one the module produced before the move, byte for
 * byte, in both languages — a relocation, not a rewrite. The per-placement records (`title`, `body`)
 * are flattened to one key per placement here and rebuilt by `pushAskCopy`.
 */
export const pushAskMessages = defineMessages({
  en: {
    titleFollow: 'Get this alert on your phone',
    titleFinderHome: 'Know the moment a starter is ruled out',
    bodyFollow: 'Turn on alerts and we’ll buzz you when he has news or is free in one of your leagues.',
    bodyFinderHome: 'Turn on alerts for game-day inactives, with the leagues to fix and who to start instead.',
    turnOn: 'Turn on alerts',
    working: 'Turning on…',
    notNow: 'Not now',
    on: 'Alerts are on for this phone.',
    iphone: 'On iPhone: tap Share, then “Add to Home Screen”, and open AllFantasy from your Home Screen to turn alerts on.',
    failed: 'Couldn’t turn alerts on. Try again from Settings → Notifications.',
  },
  es: {
    titleFollow: 'Recibe esta alerta en tu teléfono',
    titleFinderHome: 'Entérate en cuanto un titular quede descartado',
    bodyFollow: 'Activa las alertas y te avisaremos cuando tenga noticias o esté libre en una de tus ligas.',
    bodyFinderHome: 'Activa las alertas de bajas del día de partido, con las ligas a corregir y a quién alinear.',
    turnOn: 'Activar alertas',
    working: 'Activando…',
    notNow: 'Ahora no',
    on: 'Las alertas están activadas en este teléfono.',
    iphone: 'En iPhone: toca Compartir, luego «Añadir a pantalla de inicio», y abre AllFantasy desde tu pantalla de inicio para activar las alertas.',
    failed: 'No se pudieron activar las alertas. Inténtalo desde Ajustes → Notificaciones.',
  },
})
