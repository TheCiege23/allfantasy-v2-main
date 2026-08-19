'use client'

import { useMemo } from 'react'
import { MessagesSquare, X } from 'lucide-react'
import type { LeftChatInitialTab, UserLeague } from '../types'
import { LeftChatPanel } from './LeftChatPanel'
import { readDashboardToolLeagueId } from '@/lib/dashboard/dashboard-tool-league-storage'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'

/**
 * Context-aware default channel, derived from the SAME persisted dashboard scope the Hero /
 * FantasyContextEngine use (readDashboardToolLeagueId) so the panel opens to the right place:
 *  - Global (no scoped league) → Chimmy (always available; matches LeftChatPanel's own no-league default)
 *  - Commissioner / Team (a scoped league) → that league's chat (where league + commissioner messages live)
 * An explicit `requestedTab` (e.g. the Hero's "Ask Chimmy" card) always wins over this default.
 */
function contextDefaultTab(scopedLeague: UserLeague | null): LeftChatInitialTab {
  return scopedLeague ? 'league' : 'chimmy'
}

/**
 * Dashboard V2 Phase 2.5 — the Communications Hub. One floating entry point + one on-demand panel
 * wrapping the existing LeftChatPanel (League / Chimmy / AF Huddle / DMs — same system, same tabs,
 * same data contracts). Replaces the permanent left chat column: desktop opens a right-anchored
 * drawer, mobile a bottom sheet. Mounted on-demand (matches the prior mobile-drawer pattern), so it
 * never occupies dashboard space when closed. No chat internals, data, or auth are changed here.
 *
 * Designed as a *container*, not just a button, so the hub becomes part of Dashboard V2's navigation
 * language: the `unreadCount` prop drives an attention badge on the entry point, and future
 * per-channel badges (League / Chimmy / DMs / Broadcasts / Trade Offers / Draft Room / Live Game)
 * plug into THIS component — no AppShell or DashboardShell change required to add them. Counts must
 * always be real: the badge only renders for a positive count, and no live count is fabricated here.
 * Wiring live counts (a lightweight unread source) is deferred to Phase 3 so this phase stays
 * lightweight (no background polling while the hub is closed).
 */
export function FloatingCommunications({
  open,
  requestedTab,
  onOpen,
  onClose,
  unreadCount = 0,
  hideLauncher = false,
  userId,
  userName,
  userImage,
  leagues,
  activeLeagueId,
  discordConnected,
  commissionerLeagues,
}: {
  open: boolean
  /** Explicit channel to open (from a CTA); null → context default. */
  requestedTab: LeftChatInitialTab | null
  onOpen: () => void
  onClose: () => void
  /**
   * Real aggregate unread/attention count across communications channels. 0 (default) → no badge.
   * The extension seam for the hub's badge system — feed real per-channel counts here in Phase 3;
   * never pass a fabricated or placeholder value.
   */
  unreadCount?: number
  /**
   * Suppress this component's own launcher button when the host renders its own entry
   * point (the Nocturne dashboard supplies a design-matched bubble). The panel itself is
   * unchanged — only the default button is withheld. Defaults to false so existing
   * consumers keep the built-in launcher.
   */
  hideLauncher?: boolean
  userId: string
  userName: string
  userImage: string | null
  leagues: UserLeague[]
  activeLeagueId: string | null
  discordConnected: boolean
  /** Matches LeftChatPanel's commissionerLeagues contract (narrow shape, passed straight through). */
  commissionerLeagues: { id: string; name: string; teamCount: number }[]
}) {
  const { t } = useLanguage()

  // Resolve the scoped league (Hero selection) at open time so the panel reflects current context.
  const scopedLeague = useMemo(() => {
    if (!open) return null
    const id = readDashboardToolLeagueId()
    return id ? leagues.find((l) => l.id === id) ?? null : null
  }, [open, leagues])

  const initialTab = requestedTab ?? contextDefaultTab(scopedLeague)

  return (
    <>
      {/* Floating entry point — desktop/tablet. Mobile keeps the existing topbar chat button (rewired
          to the same panel), so mobile isn't given a second overlapping control. Bottom-right, above
          the safe area, sits over empty gutter so it never blocks dashboard content. */}
      {!open && !hideLauncher ? (
        <button
          type="button"
          onClick={onOpen}
          data-testid="open-communications"
          className="fixed bottom-5 right-5 z-40 hidden items-center gap-2 rounded-full border border-cyan-400/30 bg-gradient-to-br from-cyan-500/25 to-violet-500/20 px-4 py-3 text-[13px] font-bold text-white shadow-[0_8px_30px_-8px_rgba(34,211,238,0.6)] backdrop-blur-md transition hover:from-cyan-500/35 hover:to-violet-500/30 hover:shadow-[0_10px_36px_-8px_rgba(34,211,238,0.75)] active:scale-95 md:inline-flex"
          aria-label={
            unreadCount > 0
              ? `${t('dashboard.comms.open')} · ${unreadCount}`
              : t('dashboard.comms.open')
          }
        >
          <MessagesSquare className="h-4 w-4" aria-hidden />
          {t('dashboard.comms.open')}
          {/* Attention badge — only real, positive counts (Phase 3 feeds live per-channel counts). */}
          {unreadCount > 0 ? (
            <span
              data-testid="comms-unread-badge"
              className="ml-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-black leading-none text-white"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </button>
      ) : null}

      {open ? (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]"
          role="presentation"
          onClick={onClose}
        >
          <div
            className="absolute inset-x-0 bottom-0 flex max-h-[85dvh] min-h-[50dvh] flex-col overflow-hidden rounded-t-[24px] border-t border-white/[0.07] bg-[#0a0a1f] pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-12px_48px_rgba(0,0,0,0.45)] md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:min-h-0 md:w-[420px] md:max-w-[92vw] md:rounded-none md:rounded-l-[20px] md:border-l md:border-t-0 md:pb-0 md:shadow-[-12px_0_48px_rgba(0,0,0,0.45)]"
            role="dialog"
            aria-modal="true"
            aria-label={t('dashboard.comms.title')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-2 md:hidden">
              <span className="h-1 w-10 shrink-0 rounded-full bg-white/20" aria-hidden />
            </div>
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white/40">
                <MessagesSquare className="h-3.5 w-3.5 text-cyan-300/70" aria-hidden />
                {t('dashboard.comms.title')}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="touch-manipulation inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.04] text-white transition hover:bg-white/[0.08]"
                aria-label={t('dashboard.comms.close')}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <LeftChatPanel
                selectedLeague={scopedLeague}
                activeLeagueId={activeLeagueId}
                userId={userId}
                userDisplayName={userName}
                userImage={userImage}
                rootId={null}
                leagues={leagues}
                discordConnected={discordConnected}
                commissionerLeagues={commissionerLeagues}
                initialOpenChat={initialTab}
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
