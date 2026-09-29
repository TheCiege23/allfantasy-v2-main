'use client'

import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  BookOpen,
  Cloud,
  Newspaper,
  TrendingUp,
  Trophy,
  Zap,
} from 'lucide-react'

export type NotificationItem = {
  id: string
  type: string
  title: string
  body?: string | null
  severity: 'low' | 'medium' | 'high'
  createdAt: string
  readAt?: string | null
  meta?: Record<string, unknown> | null
  actionHref?: string | null
  actionLabel?: string | null
}

function typeIcon(type: string) {
  if (type.includes('injury')) return <AlertTriangle className="h-4 w-4 text-amber-400" />
  if (type.includes('news') || type.includes('breaking')) return <Newspaper className="h-4 w-4 text-cyan-400" />
  if (type.includes('score') || type.includes('swing')) return <Zap className="h-4 w-4 text-red-400" />
  if (type.includes('weather')) return <Cloud className="h-4 w-4 text-blue-400" />
  if (type.includes('trade')) return <ArrowLeftRight className="h-4 w-4 text-purple-400" />
  if (type.includes('waiver')) return <TrendingUp className="h-4 w-4 text-emerald-400" />
  if (type.includes('story')) return <BookOpen className="h-4 w-4 text-violet-400" />
  if (type.includes('draft')) return <Trophy className="h-4 w-4 text-amber-300" />
  return <Bell className="h-4 w-4 text-white/40" />
}

function severityStripe(severity: string) {
  if (severity === 'high') return 'border-l-red-500'
  if (severity === 'medium') return 'border-l-amber-500'
  return 'border-l-white/10'
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export function NotificationFeedItem({ notification }: { notification: NotificationItem }) {
  const n = notification
  const isUnread = !n.readAt
  const href = (n.meta?.actionHref as string) ?? n.actionHref ?? null

  const content = (
    <div
      className={`flex gap-3 rounded-xl border border-l-2 px-3 py-2.5 transition ${severityStripe(n.severity)} ${
        isUnread
          ? 'border-white/[0.08] bg-white/[0.04]'
          : 'border-white/[0.04] bg-white/[0.01]'
      } ${href ? 'cursor-pointer hover:bg-white/[0.06]' : ''}`}
    >
      <div className="mt-0.5 shrink-0">{typeIcon(n.type)}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-[12px] font-semibold ${isUnread ? 'text-white/90' : 'text-white/60'}`}>
            {n.title}
          </p>
          <span className="shrink-0 text-[11px] text-white/25">{timeAgo(n.createdAt)}</span>
        </div>
        {n.body && (
          <p className="mt-0.5 text-[11px] text-white/40 line-clamp-2">{n.body}</p>
        )}
        {isUnread && <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-cyan-400" />}
      </div>
    </div>
  )

  if (href) {
    return <Link href={href}>{content}</Link>
  }

  return content
}
