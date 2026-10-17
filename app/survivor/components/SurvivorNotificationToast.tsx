'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Swords, Vote, Shield, Skull, Trophy, Coins, AlertTriangle,
  Bell, MessageCircle, Flame, Crown
} from 'lucide-react'

export type SurvivorNotificationType =
  | 'challenge_posted'
  | 'challenge_closing'
  | 'vote_reminder'
  | 'vote_received'
  | 'idol_received'
  | 'idol_expiring'
  | 'tribal_tonight'
  | 'merge_announced'
  | 'exile_challenge'
  | 'token_earned'
  | 'token_wiped'
  | 'jury_voting'
  | 'finalist_question'
  | 'winner_reveal'

export type NotificationUrgency = 'low' | 'medium' | 'high' | 'critical'

interface SurvivorNotification {
  id: string
  type: SurvivorNotificationType
  title: string
  body: string
  urgency: NotificationUrgency
  spoilerSafe: boolean
  deepLink?: string
}

const NOTIF_CONFIG: Record<SurvivorNotificationType, {
  icon: typeof Bell
  color: string
  bgColor: string
  lockScreenTitle: string
}> = {
  challenge_posted: { icon: Swords, color: 'text-cyan-400', bgColor: 'bg-cyan-500/10', lockScreenTitle: 'New Challenge Available' },
  challenge_closing: { icon: AlertTriangle, color: 'text-amber-400', bgColor: 'bg-amber-500/10', lockScreenTitle: 'Challenge Closing Soon' },
  vote_reminder: { icon: Vote, color: 'text-red-400', bgColor: 'bg-red-500/10', lockScreenTitle: 'Voting Reminder' },
  vote_received: { icon: MessageCircle, color: 'text-violet-400', bgColor: 'bg-violet-500/10', lockScreenTitle: 'Action Confirmed' },
  idol_received: { icon: Shield, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', lockScreenTitle: 'You Received Something' },
  idol_expiring: { icon: AlertTriangle, color: 'text-orange-400', bgColor: 'bg-orange-500/10', lockScreenTitle: 'Power Expiring Soon' },
  tribal_tonight: { icon: Flame, color: 'text-red-400', bgColor: 'bg-red-500/10', lockScreenTitle: 'Elimination Council Tonight' },
  merge_announced: { icon: Crown, color: 'text-amber-400', bgColor: 'bg-amber-500/10', lockScreenTitle: 'Major Announcement' },
  exile_challenge: { icon: Skull, color: 'text-orange-400', bgColor: 'bg-orange-500/10', lockScreenTitle: 'Exile Challenge Live' },
  token_earned: { icon: Coins, color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', lockScreenTitle: 'Token Update' },
  token_wiped: { icon: AlertTriangle, color: 'text-red-400', bgColor: 'bg-red-500/10', lockScreenTitle: 'Token Update' },
  jury_voting: { icon: Vote, color: 'text-purple-400', bgColor: 'bg-purple-500/10', lockScreenTitle: 'Voting Open' },
  finalist_question: { icon: MessageCircle, color: 'text-amber-400', bgColor: 'bg-amber-500/10', lockScreenTitle: 'Question for You' },
  winner_reveal: { icon: Trophy, color: 'text-amber-400', bgColor: 'bg-amber-500/10', lockScreenTitle: 'Finale Event' },
}

const URGENCY_STYLES: Record<NotificationUrgency, string> = {
  low: 'border-white/10',
  medium: 'border-white/20',
  high: 'border-amber-400/30',
  critical: 'border-red-400/40 animate-pulse',
}

interface SurvivorNotificationToastProps {
  notification: SurvivorNotification
  onDismiss: () => void
  onAction?: () => void
}

export function SurvivorNotificationToast({ notification, onDismiss, onAction }: SurvivorNotificationToastProps) {
  const config = NOTIF_CONFIG[notification.type]
  const Icon = config.icon
  const [visible, setVisible] = useState(false)
  const onDismissRef = useRef(onDismiss)

  useEffect(() => {
    onDismissRef.current = onDismiss
  }, [onDismiss])

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    const timer = setTimeout(() => {
      setVisible(false)
      setTimeout(() => onDismissRef.current(), 300)
    }, notification.urgency === 'critical' ? 8000 : 5000)
    return () => clearTimeout(timer)
  }, [notification.id, notification.urgency])

  return (
    <div
      className={`fixed top-4 right-4 z-50 max-w-sm transition-all duration-300 ${
        visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      }`}
    >
      <div
        className={`rounded-2xl border ${URGENCY_STYLES[notification.urgency]} ${config.bgColor} p-4 shadow-lg backdrop-blur-sm cursor-pointer`}
        onClick={onAction ?? onDismiss}
      >
        <div className="flex items-start gap-3">
          <Icon className={`h-5 w-5 flex-shrink-0 mt-0.5 ${config.color}`} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white">{notification.title}</div>
            <div className="mt-0.5 text-xs text-white/60 line-clamp-2">{notification.body}</div>
          </div>
          <button onClick={(e) => { e.stopPropagation(); onDismiss() }} className="text-white/30 hover:text-white/60">
            <span className="text-xs">x</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Get spoiler-safe lock-screen wording for a notification type.
 */
export function getSpoilerSafeTitle(type: SurvivorNotificationType): string {
  return NOTIF_CONFIG[type]?.lockScreenTitle ?? 'Survivor Update'
}
