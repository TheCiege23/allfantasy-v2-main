'use client'

import Link from 'next/link'
import { Menu, PanelLeftClose, PanelLeft, Search, Bell, HelpCircle, UserCircle } from 'lucide-react'
import { useCommissionerLayout } from '@/components/commissioner-os/providers/CommissionerLayoutProvider'
import { useCommissionerPlatform } from '@/components/commissioner-os/providers/CommissionerPlatformProvider'
import { DataModeIndicator } from '@/components/commissioner-os/demo-mode/DataModeIndicator'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import { LeagueSelector, type LeagueSelectorOption } from '@/components/commissioner-os/shell/LeagueSelector'

export interface CommissionerHeaderProps {
  /** Fetched once by the layout via adapter.notifications.getSummary() — the header never counts unread notifications itself. */
  unreadNotificationCount?: number
  /** Fetched once by the layout via `listActiveLeaguesForUser()` — the header never queries leagues itself. */
  leagues?: LeagueSelectorOption[]
  /** Fetched once by the layout via `resolveActiveLeagueId()`. */
  activeLeagueId?: string | null
  /**
   * Which data modes this viewer may switch between — decided by the layout, never here.
   * Empty for an ordinary commissioner, who simply sees their live league.
   */
  availableDataModes?: CommissionerDataMode[]
}

/**
 * Global page header — league selector, global search, notifications,
 * profile, per the Design Language & Experience System §3. Sticky at every
 * breakpoint, fixed height, never grows with page content.
 */
export function CommissionerHeader({
  unreadNotificationCount = 0,
  leagues = [],
  activeLeagueId = null,
  availableDataModes = [],
}: CommissionerHeaderProps) {
  const { toggleSidebar, sidebarCollapsed, toggleMobileSidebar } = useCommissionerLayout()
  const { openService } = useCommissionerPlatform()

  return (
    <header
      /*
       * ⚠ `min-w-0` HERE TOO. The row is the flex container; the selector's own
       * min-w-0 chain is only half of it, and without a shrinkable slot the row
       * still sizes to its min-content width. Measured 481px in a 390px viewport
       * before this — nav 36 + selector 206 + search 42 + bell 36 + help 36, five
       * 12px gaps and 32px of padding, none of it able to give.
       */
      className="sticky top-0 z-20 flex min-w-0 items-center gap-3 border-b px-4"
      style={{ background: 'var(--panel)', borderColor: 'var(--border)', height: 'var(--control-height-large)' }}
    >
      <button
        type="button"
        aria-label="Open navigation"
        onClick={toggleMobileSidebar}
        className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center sm:min-h-0 sm:min-w-0 rounded-[var(--radius-standard)] p-2 md:hidden"
        style={{ color: 'var(--muted)' }}
      >
        <Menu size={20} aria-hidden />
      </button>
      <button
        type="button"
        aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
        onClick={toggleSidebar}
        className="focus-ring hidden rounded-[var(--radius-standard)] p-2 md:inline-flex"
        style={{ color: 'var(--muted)' }}
      >
        {sidebarCollapsed ? <PanelLeft size={20} aria-hidden /> : <PanelLeftClose size={20} aria-hidden />}
      </button>

      <LeagueSelector leagues={leagues} activeLeagueId={activeLeagueId} />

      <div className="flex-1" />

      <DataModeIndicator available={availableDataModes} />

      <button
        type="button"
        onClick={() => openService('search')}
        aria-label="Search Commissioner OS"
        className="focus-ring flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-[var(--radius-standard)] px-3 py-1.5 text-sm sm:min-h-0 sm:min-w-0"
        style={{ background: 'var(--panel2)', color: 'var(--muted)', border: '1px solid var(--border)' }}
      >
        <Search size={16} aria-hidden />
        <span className="hidden sm:inline">Search</span>
        <kbd
          className="ml-1 hidden rounded px-1.5 py-0.5 text-[10px] font-medium sm:inline"
          style={{ background: 'var(--panel)', color: 'var(--muted2)', border: '1px solid var(--border)' }}
        >
          &#8984;K
        </kbd>
      </button>

      <button
        type="button"
        onClick={() => openService('notifications')}
        aria-label={unreadNotificationCount > 0 ? `Notifications, ${unreadNotificationCount} unread` : 'Notifications'}
        className="focus-ring relative inline-flex min-h-11 min-w-11 items-center justify-center sm:min-h-0 sm:min-w-0 rounded-[var(--radius-standard)] p-2"
        style={{ color: 'var(--muted)' }}
      >
        <Bell size={20} aria-hidden />
        {unreadNotificationCount > 0 && (
          <span
            aria-hidden
            className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold"
            style={{ background: 'var(--bad)', color: '#fff' }}
          >
            {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
          </span>
        )}
      </button>

      <Link
        href="/commissioner-os/help"
        aria-label="Help & Knowledge Center"
        className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center sm:min-h-0 sm:min-w-0 rounded-[var(--radius-standard)] p-2"
        style={{ color: 'var(--muted)' }}
      >
        <HelpCircle size={20} aria-hidden />
      </Link>

      <button
        type="button"
        aria-label="Profile menu"
        className="focus-ring inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-1 sm:min-h-0 sm:min-w-0"
        style={{ color: 'var(--muted)' }}
      >
        <UserCircle size={28} aria-hidden />
      </button>
    </header>
  )
}
