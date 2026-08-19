'use client'

/**
 * Floating tabbed chat (DMs / Huddle / Chimmy) for the universal dashboard —
 * replaces the global Chimmy FAB on this route (see
 * lib/shell/draftRoomFloatingUi.ts's shouldHideChimmyFloatingFab, which now
 * hides it on /dashboard/universal so the two don't stack in the same
 * corner). Wraps the real LeftChatPanel (same component /dashboard and
 * /league/[id] use) rather than rebuilding DM/Huddle/Chimmy tab logic —
 * this is what makes Chimmy league-aware here: LeftChatPanel already
 * threads the selected league into ChimmyChat's new activeLeagueId prop.
 */

import { useEffect, useState } from 'react'
import type { UserLeague } from '@/app/dashboard/types'
import { useSettingsProfile } from '@/hooks/useSettingsProfile'
import { LeftChatPanel } from '@/app/dashboard/components/LeftChatPanel'
import styles from './universal-dashboard.module.css'

type BoardLeague = UserLeague & { navigationLeagueId?: string | null }

export function FloatingChat({ leagues }: { leagues: BoardLeague[] }) {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const { profile } = useSettingsProfile()

  useEffect(() => {
    let cancelled = false
    fetch('/api/shared/chat/threads', { cache: 'no-store', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { threads?: { unreadCount: number }[] } | null) => {
        if (cancelled || !Array.isArray(j?.threads)) return
        setUnread(j.threads.reduce((sum, t) => sum + (t.unreadCount ?? 0), 0))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!profile?.userId) return null

  const commissionerLeagues = leagues
    .filter((l) => l.isCommissioner || l.userRole === 'commissioner')
    .map((l) => ({ id: l.navigationLeagueId ?? l.id, name: l.name ?? 'Untitled league', teamCount: l.teamCount ?? 0 }))

  return (
    <div className={styles.fabWrap}>
      {open && (
        <div className={styles.fabPreview}>
          <LeftChatPanel
            rootId="universal-dashboard-floating-chat"
            selectedLeague={null}
            userId={profile.userId}
            userDisplayName={profile.displayName ?? profile.username ?? undefined}
            userImage={profile.profileImageUrl ?? null}
            leagues={leagues}
            discordConnected={Boolean(profile.discordUserId)}
            commissionerLeagues={commissionerLeagues}
            initialOpenChat="chimmy"
          />
        </div>
      )}
      <button type="button" className={styles.fabBtn} onClick={() => setOpen((v) => !v)} aria-label={open ? 'Close chat' : 'Open chat'}>
        {open ? '✕' : '💬'}
        {!open && unread > 0 && <span className={styles.fabBtnBadge}>{unread > 99 ? '99+' : unread}</span>}
      </button>
    </div>
  )
}
