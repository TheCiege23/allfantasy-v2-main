import type { NotificationsClient } from './types'

export const stubNotificationsClient: NotificationsClient = {
  async getNotifications() {
    return {
      data: [
        {
          id: 'stub-notification-1',
          severity: 'warning',
          message: 'Stub fixture notification.',
          sourceModuleId: 'league-health',
          createdAt: new Date().toISOString(),
          read: false,
        },
      ],
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },

  async getSummary() {
    return {
      data: { unreadCount: 1, criticalCount: 0, headline: '1 unread notification' },
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },
}
