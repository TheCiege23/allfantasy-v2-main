'use client'

import clsx from 'clsx'
import type { AutosaveStatus } from '@/lib/hooks/useAutosave'

export type SettingsNavTabId =
  | 'league'
  | 'team'
  | 'roster'
  | 'scoring'
  | 'draft'
  | 'divisions'
  | 'members'
  | 'coowners'
  | 'trade'
  | 'waiver'
  | 'playoff'
  | 'schedule'
  | 'ai'
  | 'notifications'
  | 'dues'
  | 'import_sync'
  | 'advanced'
  | 'appearance'
  | 'security'
  | 'draft_picks'
  | 'integrations'
  | 'commissioner'
  | 'previous'
  | 'delete'
  | 'survivor_setup'
  | 'survivor_tribes'
  | 'survivor_challenges'
  | 'survivor_tribal'
  | 'survivor_idols'
  | 'survivor_exile'
  | 'survivor_merge'
  | 'survivor_chat'
  | 'survivor_ai'
  | 'survivor_advanced'
  | 'zombie_setup'
  | 'zombie_whisperer'
  | 'zombie_combat'
  | 'zombie_items'
  | 'zombie_paid'
  | 'zombie_universe'
  | 'zombie_updates'
  | 'zombie_animations'
  | 'zombie_advanced'
  | 'zombie_ai'
  | 'idp_roster'
  | 'idp_scoring'
  | 'idp_display'
  | 'idp_ai'
  | 'idp_cap'
  | 'devy_format'
  | 'devy_roster'
  | 'devy_rules'
  | 'devy_taxi'
  | 'devy_drafts'
  | 'devy_import'
  | 'devy_ai'
  | 'c2c_format'
  | 'c2c_rosters'
  | 'c2c_scoring'
  | 'c2c_taxi'
  | 'c2c_devy'
  | 'c2c_drafts'
  | 'c2c_ai'

const BASE_NAV: { id: SettingsNavTabId; label: string }[] = [
  { id: 'league', label: 'General' },
  { id: 'team', label: 'Team' },
  { id: 'roster', label: 'Roster' },
  { id: 'scoring', label: 'Scoring' },
  { id: 'draft', label: 'Draft' },
  { id: 'divisions', label: 'Divisions' },
  { id: 'members', label: 'Members' },
  { id: 'coowners', label: 'Co-owners' },
  { id: 'trade', label: 'Trades' },
  { id: 'waiver', label: 'Waivers' },
  { id: 'playoff', label: 'Playoffs' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'ai', label: 'Decision OS' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'dues', label: 'Payments / League Dues' },
  { id: 'import_sync', label: 'Import / Sync' },
  { id: 'advanced', label: 'Advanced Rule Support' },
  { id: 'appearance', label: 'Appearance / Branding' },
  { id: 'security', label: 'Permissions' },
  { id: 'draft_picks', label: 'Draft Pick Settings' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'commissioner', label: 'Commissioner Control' },
  { id: 'previous', label: 'Previous Leagues' },
  { id: 'delete', label: 'Delete League' },
]

const ZOMBIE_NAV: { id: SettingsNavTabId; label: string }[] = [
  { id: 'zombie_setup', label: '🧟 Zombie Setup' },
  { id: 'zombie_whisperer', label: '🎭 Whisperer' },
  { id: 'zombie_combat', label: '⚔️ Combat Rules' },
  { id: 'zombie_items', label: '🧪 Serums & Weapons' },
  { id: 'zombie_paid', label: '💰 Paid / Free' },
  { id: 'zombie_universe', label: '🌍 Universe' },
  { id: 'zombie_updates', label: '📋 Weekly Updates' },
  { id: 'zombie_animations', label: '🎬 Animations' },
  { id: 'zombie_advanced', label: '⚙️ Advanced Rules' },
  { id: 'zombie_ai', label: '🤖 League Guide' },
]

const IDP_NAV: { id: SettingsNavTabId; label: string }[] = [
  { id: 'idp_roster', label: '🛡️ IDP Roster' },
  { id: 'idp_scoring', label: '📊 IDP Scoring' },
  { id: 'idp_display', label: '🎨 IDP Display' },
  { id: 'idp_ai', label: '🤖 IDP Intelligence' },
  { id: 'idp_cap', label: '💰 IDP Cap' },
]

const DEVY_NAV: { id: SettingsNavTabId; label: string }[] = [
  { id: 'devy_format', label: '🏈 League Format' },
  { id: 'devy_roster', label: '📋 Rosters' },
  { id: 'devy_rules', label: '🎓 Devy Rules' },
  { id: 'devy_taxi', label: '🚕 Taxi Rules' },
  { id: 'devy_drafts', label: '🎲 Drafts' },
  { id: 'devy_import', label: '📥 Import' },
  { id: 'devy_ai', label: '🤖 Decision OS' },
]

const C2C_NAV: { id: SettingsNavTabId; label: string }[] = [
  { id: 'c2c_format', label: '🏆 League Format' },
  { id: 'c2c_rosters', label: '📋 Rosters' },
  { id: 'c2c_scoring', label: '📊 Scoring' },
  { id: 'c2c_taxi', label: '🚕 Taxi Rules' },
  { id: 'c2c_devy', label: '🎓 Devy Rules' },
  { id: 'c2c_drafts', label: '🎲 Drafts' },
  { id: 'c2c_ai', label: '🤖 Decision OS' },
]

const SURVIVOR_NAV: { id: SettingsNavTabId; label: string }[] = [
  { id: 'survivor_setup', label: '🏝 Survivor Setup' },
  { id: 'survivor_tribes', label: '🔥 Tribes' },
  { id: 'survivor_challenges', label: '⚡ Challenges' },
  { id: 'survivor_tribal', label: '🗳 Tribal Council' },
  { id: 'survivor_idols', label: '🔮 Idols & Powers' },
  { id: 'survivor_exile', label: '🏚 Exile Island' },
  { id: 'survivor_merge', label: '🌊 Merge & Jury' },
  { id: 'survivor_chat', label: '💬 Chat & Permissions' },
  { id: 'survivor_ai', label: '🤖 League Guide' },
  { id: 'survivor_advanced', label: '⚙️ Advanced Rules' },
]

function statusLabel(s: AutosaveStatus): string | null {
  if (s === 'saving') return 'Saving…'
  if (s === 'saved') return 'Saved'
  if (s === 'error') return 'Save failed'
  return null
}

export function isSurvivorSettingsTab(id: SettingsNavTabId): boolean {
  return id.startsWith('survivor_')
}

export function isZombieSettingsTab(id: SettingsNavTabId): boolean {
  return id.startsWith('zombie_')
}

export function isIdpSettingsTab(id: SettingsNavTabId): boolean {
  return id.startsWith('idp_')
}

export function isDevySettingsTab(id: SettingsNavTabId): boolean {
  return id.startsWith('devy_')
}

export function isC2cSettingsTab(id: SettingsNavTabId): boolean {
  return id.startsWith('c2c_')
}

export function SettingsNav({
  activeTab,
  onSelect,
  saveStatus,
  showSurvivorTabs,
  showZombieTabs,
  showIdpTabs,
  showDevyTabs,
  showC2cTabs,
  className,
}: {
  activeTab: SettingsNavTabId
  onSelect: (id: SettingsNavTabId) => void
  saveStatus: AutosaveStatus
  showSurvivorTabs?: boolean
  showZombieTabs?: boolean
  showIdpTabs?: boolean
  showDevyTabs?: boolean
  showC2cTabs?: boolean
  className?: string
}) {
  const hint = statusLabel(saveStatus)
  const items = [
    ...BASE_NAV,
    ...(showSurvivorTabs ? SURVIVOR_NAV : []),
    ...(showZombieTabs ? ZOMBIE_NAV : []),
    ...(showIdpTabs ? IDP_NAV : []),
    ...(showDevyTabs ? DEVY_NAV : []),
    ...(showC2cTabs ? C2C_NAV : []),
  ]

  return (
    <nav
      className={clsx(
        'flex flex-shrink-0 flex-col gap-0.5 border-white/[0.08] bg-[#060a12] p-3 md:border-r',
        'max-h-[min(40vh,420px)] w-full overflow-x-auto overflow-y-auto md:max-h-none md:h-full md:w-[min(30%,280px)] md:min-w-[220px]',
        className,
      )}
      aria-label="League settings sections"
    >
      {items.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onSelect(t.id)}
          className={clsx(
            'rounded-xl px-3 py-2.5 text-left text-[13px] transition-colors',
            activeTab === t.id
              ? 'bg-white/[0.08] font-medium text-teal-300/95'
              : 'text-white/65 hover:bg-white/[0.05] hover:text-white/90',
          )}
        >
          {t.label}
        </button>
      ))}
      {hint ? <p className="mt-3 border-t border-white/[0.06] px-2 pt-3 text-[11px] text-white/40">{hint}</p> : null}
    </nav>
  )
}
