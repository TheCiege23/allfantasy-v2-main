'use client'

import { useCallback, useEffect, useState } from 'react'
import type { PlatformNotification } from '@/types/platform-shared'
import { mergeWithPlaceholders } from '@/lib/notifications/placeholder'
import { fetchJsonWithRetry } from '@/lib/error-handling'
import {
  getNotificationsEndpoint,
  getNotificationReadEndpoint,
  getNotificationsReadAllEndpoint,
} from '@/lib/notification-center'
import { addStateRefreshListener } from '@/lib/state-consistency/state-events'

export function useNotifications(
  limit = 8,
  options?: { usePlaceholders?: boolean; leagueId?: string | null }
) {
  const usePlaceholders = options?.usePlaceholders ?? true
  const leagueId = options?.leagueId ?? null
  const [notifications, setNotifications] = useState<PlatformNotification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const json = await fetchJsonWithRetry<{ notifications?: PlatformNotification[] }>(
        getNotificationsEndpoint(limit, { leagueId }),
        { cache: 'no-store' },
        { maxAttempts: 3, context: 'notifications' }
      )
      const raw = Array.isArray(json?.notifications) ? json.notifications : []
      setNotifications(mergeWithPlaceholders(raw, usePlaceholders))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load notifications')
    } finally {
      setLoading(false)
    }
  }, [limit, usePlaceholders, leagueId])

  useEffect(() => {
    let mounted = true
    void load().then(() => {
      if (!mounted) return
    })
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void load()
    }, 45_000)
    const unsub = addStateRefreshListener(['leagues', 'notifications', 'all'], () => {
      void load()
    })
    return () => {
      mounted = false
      clearInterval(timer)
      unsub()
    }
  }, [load])

  const markAsRead = useCallback(async (notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    )
    try {
      await fetch(getNotificationReadEndpoint(notificationId), {
        method: 'PATCH',
      })
    } catch {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: false } : n))
      )
    }
  }, [])

  const markAllAsRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    try {
      await fetch(getNotificationsReadAllEndpoint({ leagueId }), { method: 'PATCH' })
      await load()
    } catch {
      await load()
    }
  }, [leagueId, load])

  return { notifications, loading, error, markAsRead, markAllAsRead, refresh: load }
}
