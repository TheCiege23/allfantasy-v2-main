import { defineMessages } from '@/lib/i18n/messages'

/**
 * Notifications center (components/core-app/screens/NotificationsCenter.tsx). Every string is the one
 * the screen printed before the move, byte for byte, in both languages — a relocation, not a rewrite.
 */
export const notificationsCenterMessages = defineMessages({
  en: {
    justNow: 'just now',
    minsAgo: (mins: number) => `${mins}m ago`,
    hoursAgo: (hours: number) => `${hours}h ago`,
    daysAgo: (days: number) => `${days}d ago`,
    matchingNotices: (n: number) => ` · ${n} matching notices`,
    loading: 'Loading notifications…',
    waiting: (unread: number, inLeague: boolean) =>
      `${unread} waiting${inLeague ? ' in this league' : ''}. The ones with a clock on them are at the top.`,
    olderNotListed: (listed: number, older: number) =>
      `The ${listed} most recent are listed here. ${older} older ${older === 1 ? 'notification is' : 'notifications are'} not shown, so the counts above describe this page rather than everything you have.`,
    nothingUnder: (filter: string) => `Nothing under ${filter}.`,
  },
  es: {
    justNow: 'ahora mismo',
    minsAgo: (mins) => `hace ${mins} min`,
    hoursAgo: (hours) => `hace ${hours} h`,
    daysAgo: (days) => `hace ${days} d`,
    matchingNotices: (n) => ` · ${n} avisos coincidentes`,
    loading: 'Cargando notificaciones…',
    waiting: (unread, inLeague) => `${unread} pendientes${inLeague ? ' en esta liga' : ''}. Los avisos con plazo aparecen primero.`,
    olderNotListed: (listed, older) =>
      `Aquí se muestran los ${listed} avisos más recientes. ${older} anteriores no aparecen; los conteos de arriba describen esta página, no todos tus avisos.`,
    nothingUnder: (filter) => `Nada en ${filter}.`,
  },
})
