/**
 * Words for the in-context push ask (components/core-app/player-finder/PushAsk.tsx, 2026-10-10).
 * Pure, client-safe; English and Spanish.
 */

export type PushAskPlacement = 'follow' | 'finder_home'

export type PushAskCopy = {
  title: Record<PushAskPlacement, string>
  body: Record<PushAskPlacement, string>
  turnOn: string
  working: string
  notNow: string
  on: string
  iphone: string
  failed: string
}

const EN: PushAskCopy = {
  title: {
    follow: 'Get this alert on your phone',
    finder_home: 'Know the moment a starter is ruled out',
  },
  body: {
    follow: 'Turn on alerts and we’ll buzz you when he has news or is free in one of your leagues.',
    finder_home: 'Turn on alerts for game-day inactives, with the leagues to fix and who to start instead.',
  },
  turnOn: 'Turn on alerts',
  working: 'Turning on…',
  notNow: 'Not now',
  on: 'Alerts are on for this phone.',
  iphone: 'On iPhone: tap Share, then “Add to Home Screen”, and open AllFantasy from your Home Screen to turn alerts on.',
  failed: 'Couldn’t turn alerts on. Try again from Settings → Notifications.',
}

const ES: PushAskCopy = {
  title: {
    follow: 'Recibe esta alerta en tu teléfono',
    finder_home: 'Entérate en cuanto un titular quede descartado',
  },
  body: {
    follow: 'Activa las alertas y te avisaremos cuando tenga noticias o esté libre en una de tus ligas.',
    finder_home: 'Activa las alertas de bajas del día de partido, con las ligas a corregir y a quién alinear.',
  },
  turnOn: 'Activar alertas',
  working: 'Activando…',
  notNow: 'Ahora no',
  on: 'Las alertas están activadas en este teléfono.',
  iphone: 'En iPhone: toca Compartir, luego «Añadir a pantalla de inicio», y abre AllFantasy desde tu pantalla de inicio para activar las alertas.',
  failed: 'No se pudieron activar las alertas. Inténtalo desde Ajustes → Notificaciones.',
}

export function pushAskCopy(language: string): PushAskCopy {
  return language === 'es' ? ES : EN
}
