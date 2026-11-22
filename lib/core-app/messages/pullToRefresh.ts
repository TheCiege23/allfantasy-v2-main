import { defineMessages } from '@/lib/i18n/messages'

/**
 * Pull to refresh's indicator (components/core-app/PullToRefresh.tsx). Every string is the one the
 * indicator printed before the move, byte for byte, in both languages — a relocation, not a rewrite.
 */
export const pullToRefreshMessages = defineMessages({
  en: {
    refreshing: 'Refreshing…',
    upToDate: 'Up to date',
    releaseToRefresh: 'Release to refresh',
    pullToRefresh: 'Pull to refresh',
  },
  es: {
    refreshing: 'Actualizando…',
    upToDate: 'Al día',
    releaseToRefresh: 'Suelta para actualizar',
    pullToRefresh: 'Desliza para actualizar',
  },
})
