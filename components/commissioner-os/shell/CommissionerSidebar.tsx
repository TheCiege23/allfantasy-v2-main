'use client'

import Link from 'next/link'
import {
  LayoutDashboard,
  HeartPulse,
  Lightbulb,
  Users,
  Briefcase,
  Zap,
  BarChart3,
  FileText,
  Settings as SettingsIcon,
  Activity as ActivityIcon,
  HelpCircle,
  type LucideIcon,
} from 'lucide-react'
import {
  COMMISSIONER_MODULE_NAV_ITEMS,
  COMMISSIONER_SECONDARY_NAV_ITEMS,
  type CommissionerModuleId,
  type CommissionerModuleNavItem,
} from '@/lib/commissioner-ui/navigation/moduleNav'
import { useCommissionerNavigation } from '@/components/commissioner-os/providers/CommissionerNavigationProvider'
import { useCommissionerLayout } from '@/components/commissioner-os/providers/CommissionerLayoutProvider'
import { useCommissionerFeatureFlags } from '@/components/commissioner-os/providers/CommissionerFeatureFlagProvider'

/**
 * One icon library, used exhaustively (Design Language & Experience System
 * §13) — reuses lucide-react, already a dependency and already used
 * elsewhere in this app. Exported so any other surface keyed by the same
 * `CommissionerModuleId` (Notification Center's per-source-module icons)
 * reuses this exact mapping rather than defining a second one that could
 * drift out of sync.
 */
export const MODULE_ICONS: Record<CommissionerModuleId, LucideIcon> = {
  'mission-control': LayoutDashboard,
  'league-health': HeartPulse,
  recommendations: Lightbulb,
  managers: Users,
  workspace: Briefcase,
  automations: Zap,
  analytics: BarChart3,
  reports: FileText,
  settings: SettingsIcon,
  activity: ActivityIcon,
  help: HelpCircle,
}

export function CommissionerSidebar() {
  const { activeModuleId } = useCommissionerNavigation()
  const { sidebarCollapsed, mobileSidebarOpen, closeMobileSidebar } = useCommissionerLayout()
  const { isModuleEnabled } = useCommissionerFeatureFlags()

  return (
    <>
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={closeMobileSidebar}
          className="fixed inset-0 z-20 md:hidden"
          style={{ background: 'var(--overlay)' }}
        />
      )}
      <nav
        aria-label="Commissioner OS"
        className={[
          'fixed md:sticky top-0 z-30 h-screen w-64 flex-shrink-0 flex flex-col border-r transition-transform duration-200 motion-reduce:transition-none',
          'md:top-0 md:h-screen',
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          sidebarCollapsed ? 'md:w-16' : 'md:w-60',
        ].join(' ')}
        style={{ background: 'var(--panel)', borderColor: 'var(--border)' }}
      >
        <SidebarList
          items={COMMISSIONER_MODULE_NAV_ITEMS}
          activeModuleId={activeModuleId}
          collapsed={sidebarCollapsed}
          isModuleEnabled={isModuleEnabled}
          onNavigate={closeMobileSidebar}
        />
        <div className="mt-auto border-t" style={{ borderColor: 'var(--border)' }}>
          <SidebarList
            items={COMMISSIONER_SECONDARY_NAV_ITEMS}
            activeModuleId={activeModuleId}
            collapsed={sidebarCollapsed}
            isModuleEnabled={isModuleEnabled}
            onNavigate={closeMobileSidebar}
          />
        </div>
      </nav>
    </>
  )
}

function SidebarList({
  items,
  activeModuleId,
  collapsed,
  isModuleEnabled,
  onNavigate,
}: {
  items: CommissionerModuleNavItem[]
  activeModuleId: CommissionerModuleId | null
  collapsed: boolean
  isModuleEnabled: (id: CommissionerModuleId) => boolean
  onNavigate: () => void
}) {
  return (
    <ul className="flex flex-col gap-1 p-2">
      {items.map((item) => {
        const Icon = MODULE_ICONS[item.id]
        const active = item.id === activeModuleId
        const enabled = isModuleEnabled(item.id)
        return (
          <li key={item.id}>
            <Link
              href={enabled ? item.href : '#'}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              aria-disabled={!enabled}
              tabIndex={enabled ? 0 : -1}
              className={`focus-ring flex items-center gap-3 rounded-[var(--radius-standard)] px-3 py-2 text-sm font-medium transition-premium hover:opacity-90 ${
                !enabled ? 'pointer-events-none' : ''
              }`}
              style={{
                background: active ? 'var(--panel2)' : 'transparent',
                color: active ? 'var(--text)' : 'var(--muted)',
                opacity: enabled ? 1 : 0.5,
                borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              <Icon size={20} aria-hidden />
              {!collapsed && <span>{item.label}</span>}
              {!enabled && !collapsed && (
                <span
                  className="ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{ background: 'var(--status-disabled-bg)', color: 'var(--status-disabled-text)' }}
                >
                  Off
                </span>
              )}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
