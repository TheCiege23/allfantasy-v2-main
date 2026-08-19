'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bell,
  CheckCheck,
  Loader2,
  Megaphone,
  MessageSquare,
  RefreshCw,
  Send,
} from 'lucide-react'
import { useNotifications } from '@/hooks/useNotifications'
import { getUnreadCount } from '@/lib/notification-center'
import type { PlatformChatMessage } from '@/types/platform-shared'

type FeedItem = {
  id: string
  type: string
  message: string
  title?: string | null
  createdAt: string
}

type Props = {
  leagueId: string
  isCommissioner: boolean
  onOpenChat?: () => void
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

function clip(text: string, max = 118): string {
  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text
}

export function RedraftCommunicationPanel({ leagueId, isCommissioner, onOpenChat }: Props) {
  const notificationState = useNotifications(20, { usePlaceholders: false, leagueId })
  const {
    notifications,
    loading: notificationsLoading,
    markAllAsRead,
    refresh: refreshNotifications,
  } = notificationState
  const unreadCount = getUnreadCount(notifications)
  const [feedItems, setFeedItems] = useState<FeedItem[]>([])
  const [systemMessages, setSystemMessages] = useState<PlatformChatMessage[]>([])
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [announcementSending, setAnnouncementSending] = useState(false)
  const [chatBody, setChatBody] = useState('')
  const [chatSending, setChatSending] = useState(false)

  const loadFeed = useCallback(async () => {
    setFeedLoading(true)
    setFeedError(null)
    try {
      const res = await fetch(`/api/redraft/communication/feed?leagueId=${encodeURIComponent(leagueId)}&limit=20`, {
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFeedError(typeof json?.error === 'string' ? json.error : 'Unable to load league feed')
        setFeedItems([])
        setSystemMessages([])
        return
      }
      setFeedItems(Array.isArray(json?.items) ? json.items : [])
      setSystemMessages(Array.isArray(json?.systemMessages) ? json.systemMessages : [])
    } catch {
      setFeedError('Unable to load league feed')
      setFeedItems([])
      setSystemMessages([])
    } finally {
      setFeedLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

  const recentNotifications = useMemo(
    () => notifications.slice(0, 3),
    [notifications],
  )

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshNotifications(), loadFeed()])
  }, [loadFeed, refreshNotifications])

  const sendAnnouncement = useCallback(async () => {
    const body = announcement.trim()
    if (!body || announcementSending) return
    setAnnouncementSending(true)
    try {
      const res = await fetch('/api/redraft/communication/announcements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          title: 'Commissioner announcement',
          body,
          announcementType: 'league',
          mirrorToDiscord: true,
        }),
      })
      if (res.ok) {
        setAnnouncement('')
        await refreshAll()
      }
    } finally {
      setAnnouncementSending(false)
    }
  }, [announcement, announcementSending, leagueId, refreshAll])

  const sendChat = useCallback(async () => {
    const body = chatBody.trim()
    if (!body || chatSending) return
    setChatSending(true)
    try {
      const res = await fetch('/api/redraft/communication/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leagueId, body, messageType: 'text' }),
      })
      if (res.ok) {
        setChatBody('')
        await loadFeed()
      }
    } finally {
      setChatSending(false)
    }
  }, [chatBody, chatSending, leagueId, loadFeed])

  return (
    <section
      className="mt-5 rounded-3xl border border-white/[0.08] bg-black/20 p-4"
      data-testid="g42-communication-panel"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-violet-200" aria-hidden />
            <h3 className="text-base font-black text-white">League communication</h3>
            {unreadCount > 0 ? (
              <span
                className="rounded-full border border-[#ff9ec0]/40 bg-[#ff3d81]/15 px-2 py-0.5 text-[10px] font-bold text-[#ffd7e5]"
                data-testid="g42-unread-badge"
              >
                {unreadCount} unread
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs leading-5 text-white/50">
            Draft, waivers, trades, scoring, playoffs, announcements, and chat in one league feed.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => void markAllAsRead()}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-white/10 px-2.5 text-[11px] font-bold text-[#ffd7e5] hover:bg-white/[0.06]"
              data-testid="g42-mark-all-read"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Read
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void refreshAll()}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-white/10 px-2.5 text-[11px] font-bold text-white/70 hover:bg-white/[0.06]"
            data-testid="g42-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]" data-testid="g42-mobile-layout">
        <div className="min-w-0 space-y-3">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-[#ffb8d1]" aria-hidden />
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/55">Notifications</p>
            </div>
            {notificationsLoading ? (
              <p className="mt-3 text-xs text-white/45">Loading...</p>
            ) : recentNotifications.length === 0 ? (
              <p className="mt-3 text-xs text-white/45">No league notifications yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {recentNotifications.map((notification) => (
                  <li
                    key={notification.id}
                    className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2"
                    data-testid="g42-notification-row"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold text-white/85">{notification.title}</p>
                      <span className="shrink-0 text-[10px] text-white/30">{timeAgo(notification.createdAt)}</span>
                    </div>
                    {notification.body ? (
                      <p className="mt-1 text-[11px] leading-4 text-white/45">{clip(notification.body)}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-violet-200" aria-hidden />
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/55">System feed</p>
            </div>
            {feedLoading ? (
              <p className="mt-3 text-xs text-white/45">Loading...</p>
            ) : feedError ? (
              <p className="mt-3 text-xs text-red-300">{feedError}</p>
            ) : feedItems.length === 0 && systemMessages.length === 0 ? (
              <p className="mt-3 text-xs text-white/45">No league communication yet.</p>
            ) : (
              <ul className="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
                {systemMessages.slice(0, 3).map((message) => (
                  <li
                    key={message.id}
                    className="rounded-xl border border-[#ff9ec0]/10 bg-[#ff3d81]/[0.06] px-3 py-2"
                    data-testid="g42-chat-system-message"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold text-[#ffd7e5]">{message.senderName || 'AllFantasy'}</p>
                      <span className="shrink-0 text-[10px] text-white/30">{timeAgo(message.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-white/55">{clip(message.body)}</p>
                  </li>
                ))}
                {feedItems.slice(0, 5).map((item) => (
                  <li key={item.id} className="rounded-xl border border-white/[0.06] bg-black/20 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-bold text-white/80">{item.title || item.message}</p>
                      <span className="shrink-0 text-[10px] text-white/30">{timeAgo(item.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-4 text-white/45">{clip(item.message)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {isCommissioner ? (
            <div className="rounded-2xl border border-amber-300/15 bg-amber-300/[0.06] p-3">
              <div className="flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-amber-200" aria-hidden />
                <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-100/80">Announcement</p>
              </div>
              <textarea
                value={announcement}
                onChange={(event) => setAnnouncement(event.target.value)}
                rows={3}
                placeholder="Commissioner announcement"
                className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none placeholder:text-white/25 focus:border-amber-200/40"
                data-testid="g42-announcement-input"
              />
              <button
                type="button"
                disabled={!announcement.trim() || announcementSending}
                onClick={() => void sendAnnouncement()}
                className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-amber-200/30 bg-amber-300/10 px-3 text-xs font-bold text-amber-100 disabled:opacity-45"
                data-testid="g42-announcement-send"
              >
                {announcementSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send announcement
              </button>
            </div>
          ) : null}

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-[#ffb8d1]" aria-hidden />
              <p className="text-xs font-black uppercase tracking-[0.16em] text-white/55">League chat</p>
            </div>
            <textarea
              value={chatBody}
              onChange={(event) => setChatBody(event.target.value)}
              rows={2}
              placeholder="Message league chat"
              className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-white outline-none placeholder:text-white/25 focus:border-[#ffb8d1]/40"
              data-testid="g42-chat-input"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={!chatBody.trim() || chatSending}
                onClick={() => void sendChat()}
                className="inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#ffb8d1]/30 bg-[#ff9ec0]/10 px-3 text-xs font-bold text-[#ffd7e5] disabled:opacity-45"
                data-testid="g42-chat-send"
              >
                {chatSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send
              </button>
              {onOpenChat ? (
                <button
                  type="button"
                  onClick={onOpenChat}
                  className="inline-flex min-h-9 items-center rounded-xl border border-white/10 px-3 text-xs font-bold text-white/65"
                >
                  Open
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
