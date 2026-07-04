'use client'

import Link from 'next/link'
import { Menu, PanelLeftClose, PanelLeft, Search, Bell, HelpCircle, UserCircle, ChevronDown } from 'lucide-react'
import { useCommissionerLayout } from '@/components/commissioner-os/providers/CommissionerLayoutProvider'
import { useCommissionerPlatform } from '@/components/commissioner-os/providers/CommissionerPlatformProvider'
import { DataModeIndicator } from '@/components/commissioner-os/demo-mode/DataModeIndicator'

export interface CommissionerHeaderProps {
  /** Fetched once by the layout via adapter.notifications.getSummary() — the header never counts unread notifications itself. */
  unreadNotificationCount?: number
  /** Server-resolved isSiteAdmin() from the layout — see DataModeIndicator's own doc comment. */
  isDataModeAdmin?: boolean
}

/**
 * Global page header — league selector, global search, notifications,
 * profile, per the Design Language & Experience System §3. Sticky at every
 * breakpoint, fixed height, never grows with page content.
 */
export function CommissionerHeader({ unreadNotificationCount = 0, isDataModeAdmin = false }: CommissionerHeaderProps) {
  const { toggleSidebar, sidebarCollapsed, toggleMobileSidebar } = useCommissionerLayout()
  const { openService } = useCommissionerPlatform()

  return (
    <header
      className="sticky top-0 z-20 flex items-center gap-3 border-b px-4"
      style={{ background: 'var(--panel)', borderColor: 'var(--border)', height: 'var(--control-height-large)' }}
    >
      <button
        type="button"
        aria-label="Open navigation"
        onClick={toggleMobileSidebar}
        className="focus-ring rounded-[var(--radius-standard)] p-2 md:hidden"
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

      {/* League selector — placeholder. Real implementation reads League
          Snapshot (Mission Control Addendum A) once a real league data
          source is wired up through the Decision OS client interface. */}
      <button
        type="button"
        className="focus-ring flex items-center gap-1 rounded-[var(--radius-standard)] px-3 py-1.5 text-sm font-medium"
        style={{ background: 'var(--panel2)', color: 'var(--text)', border: '1px solid var(--border)' }}
      >
        <span>Select league</span>
        <ChevronDown size={16} aria-hidden />
      </button>

      <div className="flex-1" />

      <DataModeIndicator isAdmin={isDataModeAdmin} />

      <button
        type="button"
        onClick={() => openService('search')}
        aria-label="Search Commissioner OS"
        className="focus-ring flex items-center gap-2 rounded-[var(--radius-standard)] px-3 py-1.5 text-sm"
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
        className="focus-ring relative rounded-[var(--radius-standard)] p-2"
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
        className="focus-ring rounded-[var(--radius-standard)] p-2"
        style={{ color: 'var(--muted)' }}
      >
        <HelpCircle size={20} aria-hidden />
      </Link>

      <button
        type="button"
        aria-label="Profile menu"
        className="focus-ring rounded-full p-1"
        style={{ color: 'var(--muted)' }}
      >
        <UserCircle size={28} aria-hidden />
      </button>
    </header>
  )
}
