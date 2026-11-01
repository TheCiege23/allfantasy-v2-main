'use client'

import { useState } from 'react'
import clsx from 'clsx'
import {
  ArrowLeftRight,
  BarChart3,
  Bell,
  Bot,
  Brain,
  CalendarDays,
  CarTaxiFront,
  ClipboardList,
  Clapperboard,
  Dice5,
  DollarSign,
  Download,
  Drama,
  Flame,
  FlaskConical,
  Gem,
  Globe,
  GraduationCap,
  History,
  Layers,
  ListOrdered,
  Lock,
  MessageSquare,
  Network,
  Palette,
  Palmtree,
  Plug,
  Repeat,
  RefreshCw,
  RotateCcw,
  Rows3,
  Scale,
  Settings,
  Shield,
  ShieldCheck,
  Skull,
  SlidersHorizontal,
  Swords,
  Tent,
  Ticket,
  Trash2,
  Trophy,
  UserPlus,
  UserRound,
  Users,
  Vote,
  Wallet,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { AutosaveStatus } from '@/lib/hooks/useAutosave'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

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
  | 'survivor_governance'
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
  | 'native_devy'
  | 'native_c2c'

/** `labelKey`: a dictionary key (English and Spanish) that wins over the fixed English `label`. */
type NavEntry = { id: SettingsNavTabId; label: string; icon: LucideIcon; labelKey?: string }

/** One row in the nav. `key` is unique even where two rows open the same tab (Format & roster / Taxi squad). */
export type SettingsNavItem = {
  key: string
  id: SettingsNavTabId
  /** Fixed English label, as these tabs have always had. */
  label?: string
  /** Dictionary key, for the labels the dynasty grouping adds (English and Spanish). */
  labelKey?: string
  icon: LucideIcon
  /** The element id to scroll to once the tab is open — the taxi section inside the Roster tab. */
  anchor?: string
}

export type SettingsNavGroup = {
  key: string
  /** Dictionary key for the group heading; the flat (non-dynasty) list has none. */
  headingKey?: string
  /** The Dynasty heading is the one drawn in gold. */
  accent?: boolean
  items: SettingsNavItem[]
}

/** The id of the taxi squad section in the Roster tab, which the Dynasty group's "Taxi squad" row scrolls to. */
export const TAXI_SECTION_ANCHOR = 'settings-taxi-squad'

const BASE_NAV: NavEntry[] = [
  { id: 'league', label: 'General', icon: Settings },
  { id: 'team', label: 'Team', icon: UserRound },
  { id: 'roster', label: 'Roster', icon: ListOrdered },
  { id: 'scoring', label: 'Scoring', icon: BarChart3 },
  { id: 'draft', label: 'Draft', icon: ClipboardList },
  { id: 'divisions', label: 'Divisions', icon: Network },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'coowners', label: 'Co-owners', icon: UserPlus },
  { id: 'trade', label: 'Trades', icon: ArrowLeftRight },
  { id: 'waiver', label: 'Waivers', icon: Repeat },
  { id: 'playoff', label: 'Playoffs', icon: Trophy },
  { id: 'schedule', label: 'Schedule', icon: CalendarDays },
  { id: 'ai', label: 'Commissioner Intelligence', icon: Brain },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'dues', label: 'Payments / League Dues', icon: Wallet },
  { id: 'import_sync', label: 'Import / Sync', icon: RefreshCw },
  { id: 'advanced', label: 'Advanced Rule Support', icon: SlidersHorizontal },
  { id: 'appearance', label: 'Appearance / Branding', icon: Palette },
  { id: 'security', label: 'Permissions', icon: Lock },
  { id: 'draft_picks', label: 'Draft Pick Settings', icon: Ticket },
  { id: 'integrations', label: 'Integrations', icon: Plug },
  { id: 'commissioner', label: 'Commissioner Control', icon: ShieldCheck },
  { id: 'previous', label: 'Previous Leagues', icon: History },
  { id: 'delete', label: 'Delete League', icon: Trash2 },
]

const ZOMBIE_NAV: NavEntry[] = [
  { id: 'zombie_setup', label: 'Zombie Setup', icon: Skull },
  { id: 'zombie_whisperer', label: 'Whisperer', icon: Drama },
  { id: 'zombie_combat', label: 'Combat Rules', icon: Swords },
  { id: 'zombie_items', label: 'Serums & Weapons', icon: FlaskConical },
  { id: 'zombie_paid', label: 'Paid / Free', icon: DollarSign },
  { id: 'zombie_universe', label: 'Universe', icon: Globe },
  { id: 'zombie_updates', label: 'Weekly Updates', icon: ClipboardList },
  { id: 'zombie_animations', label: 'Animations', icon: Clapperboard },
  { id: 'zombie_advanced', label: 'Advanced Rules', icon: SlidersHorizontal },
  { id: 'zombie_ai', label: 'League Guide', icon: Bot },
]

const IDP_NAV: NavEntry[] = [
  { id: 'idp_roster', label: 'IDP Roster', icon: Shield },
  { id: 'idp_scoring', label: 'IDP Scoring', icon: BarChart3 },
  { id: 'idp_display', label: 'IDP Display', icon: Palette },
  { id: 'idp_ai', label: 'IDP Intelligence', icon: Bot },
  { id: 'idp_cap', label: 'IDP Cap', icon: DollarSign },
]

const DEVY_NAV: NavEntry[] = [
  { id: 'devy_format', label: 'League Format', icon: Layers },
  { id: 'devy_roster', label: 'Rosters', icon: ClipboardList },
  { id: 'devy_rules', label: 'Devy Rules', icon: GraduationCap },
  { id: 'devy_taxi', label: 'Taxi Rules', icon: CarTaxiFront },
  { id: 'devy_drafts', label: 'Drafts', icon: Dice5 },
  { id: 'devy_import', label: 'Import', icon: Download },
  { id: 'devy_ai', label: 'League Guide', icon: Bot },
]

const C2C_NAV: NavEntry[] = [
  { id: 'c2c_format', label: 'League Format', icon: Trophy },
  { id: 'c2c_rosters', label: 'Rosters', icon: ClipboardList },
  { id: 'c2c_scoring', label: 'Scoring', icon: BarChart3 },
  { id: 'c2c_taxi', label: 'Taxi Rules', icon: CarTaxiFront },
  { id: 'c2c_devy', label: 'Devy Rules', icon: GraduationCap },
  { id: 'c2c_drafts', label: 'Drafts', icon: Dice5 },
  { id: 'c2c_ai', label: 'League Guide', icon: Bot },
]

/**
 * The editors for a Devy or C2C league that plays on AllFantasy. Its settings live in
 * `DevyLeagueConfig` / `C2CLeagueConfig` (written at league creation), not in the legacy
 * `DevyLeague` / `C2CLeague` records the DEVY_NAV / C2C_NAV tabs read, so those tabs never showed for
 * such a league. Prefixed `native_` so the legacy tabs' guards (`isDevySettingsTab`) leave them alone.
 */
const NATIVE_DEVY_NAV: NavEntry[] = [{ id: 'native_devy', label: 'Devy Settings', icon: GraduationCap }]
const NATIVE_C2C_NAV: NavEntry[] = [{ id: 'native_c2c', label: 'C2C Settings', icon: Trophy }]

const SURVIVOR_NAV: NavEntry[] = [
  { id: 'survivor_setup', label: 'Survivor Setup', icon: Palmtree },
  { id: 'survivor_tribes', label: 'Tribes', icon: Flame },
  { id: 'survivor_challenges', label: 'Challenges', icon: Zap },
  { id: 'survivor_tribal', label: 'Torch Ceremony', icon: Vote },
  { id: 'survivor_idols', label: 'Idols & Powers', icon: Gem },
  { id: 'survivor_exile', label: 'Exile Island', icon: Tent },
  { id: 'survivor_merge', label: 'Merge & Jury', icon: Waves },
  { id: 'survivor_chat', label: 'Chat & Permissions', icon: MessageSquare },
  { id: 'survivor_ai', label: 'League Guide', icon: Bot },
  { id: 'survivor_governance', label: 'Rules & Conduct', icon: Scale, labelKey: 'settingsNav.survivor.governance' },
  { id: 'survivor_advanced', label: 'Advanced Rules', icon: SlidersHorizontal },
]

export type SettingsNavOptions = {
  showSurvivorTabs?: boolean
  showZombieTabs?: boolean
  showIdpTabs?: boolean
  showDevyTabs?: boolean
  showC2cTabs?: boolean
  showNativeDevyTab?: boolean
  showNativeC2cTab?: boolean
  /** A dynasty-family league (`usesDynastyBackground`): group the nav into League / Dynasty / People. */
  dynasty?: boolean
}

const asItems = (entries: NavEntry[]): SettingsNavItem[] => entries.map((e) => ({ key: e.id, id: e.id, label: e.label, icon: e.icon, ...(e.labelKey ? { labelKey: e.labelKey } : {}) }))
const base = (id: SettingsNavTabId): SettingsNavItem => {
  const e = BASE_NAV.find((n) => n.id === id)!
  return { key: e.id, id: e.id, label: e.label, icon: e.icon }
}

/** The format-specific tab sets, in the order they have always been appended. */
function formatEntries(o: SettingsNavOptions, includeNative: boolean): Array<{ key: string; headingKey: string; entries: NavEntry[] }> {
  return [
    o.showSurvivorTabs ? { key: 'survivor', headingKey: 'settingsNav.group.survivor', entries: SURVIVOR_NAV } : null,
    o.showZombieTabs ? { key: 'zombie', headingKey: 'settingsNav.group.zombie', entries: ZOMBIE_NAV } : null,
    o.showIdpTabs ? { key: 'idp', headingKey: 'settingsNav.group.idp', entries: IDP_NAV } : null,
    o.showDevyTabs ? { key: 'devy', headingKey: 'settingsNav.group.devy', entries: DEVY_NAV } : null,
    o.showC2cTabs ? { key: 'c2c', headingKey: 'settingsNav.group.c2c', entries: C2C_NAV } : null,
    includeNative && o.showNativeDevyTab ? { key: 'native_devy', headingKey: 'settingsNav.group.devy', entries: NATIVE_DEVY_NAV } : null,
    includeNative && o.showNativeC2cTab ? { key: 'native_c2c', headingKey: 'settingsNav.group.c2c', entries: NATIVE_C2C_NAV } : null,
  ].filter((g): g is NonNullable<typeof g> => g !== null)
}

/**
 * The nav's rows. Pure, so the grouping is testable without rendering.
 *
 * Not a dynasty league: ONE heading-less group holding exactly the list the nav has always shown, in
 * the same order. Only the icons changed.
 *
 * A dynasty league: League / Dynasty / People, then the format-specific groups. The Dynasty group is
 * made of tabs that already exist — it adds no editor:
 *   Format & roster       → 'roster'      (format presets, slots, reserves; RosterComplianceSettingsPanel)
 *   Taxi squad            → 'roster'      scrolled to TaxiSquadSettingsSection (the one taxi editor)
 *   Devy & prospects      → 'native_devy' / 'native_c2c', only when that editor answers (#3061)
 *   Rookie draft & picks  → 'draft_picks' (future pick seasons + pick terms)
 *   Trades                → 'trade'
 *   Offseason & rollover  → 'advanced'    (the offseason calendar)
 * Every BASE tab appears exactly once outside the Taxi row.
 */
export function buildSettingsNavGroups(o: SettingsNavOptions): SettingsNavGroup[] {
  if (!o.dynasty) {
    const flat = [
      ...BASE_NAV,
      ...formatEntries(o, true).flatMap((g) => g.entries),
    ]
    return [{ key: 'all', items: asItems(flat) }]
  }

  const devyRows: SettingsNavItem[] = []
  if (o.showNativeDevyTab) {
    devyRows.push({ key: 'dyn_devy', id: 'native_devy', labelKey: 'settingsNav.dynasty.devy', icon: GraduationCap })
  }
  if (o.showNativeC2cTab) {
    devyRows.push(
      o.showNativeDevyTab
        ? { key: 'native_c2c', id: 'native_c2c', label: 'C2C Settings', icon: Trophy }
        : { key: 'dyn_devy', id: 'native_c2c', labelKey: 'settingsNav.dynasty.devy', icon: GraduationCap },
    )
  }

  const groups: SettingsNavGroup[] = [
    {
      key: 'league',
      headingKey: 'settingsNav.group.league',
      items: (['league', 'scoring', 'draft', 'divisions', 'waiver', 'playoff', 'schedule', 'ai', 'notifications', 'dues', 'import_sync', 'appearance', 'integrations', 'previous', 'delete'] as const).map(base),
    },
    {
      key: 'dynasty',
      headingKey: 'settingsNav.group.dynasty',
      accent: true,
      items: [
        { key: 'dyn_format', id: 'roster', labelKey: 'settingsNav.dynasty.format', icon: Rows3 },
        { key: 'dyn_taxi', id: 'roster', labelKey: 'settingsNav.dynasty.taxi', icon: CarTaxiFront, anchor: TAXI_SECTION_ANCHOR },
        ...devyRows,
        { key: 'dyn_picks', id: 'draft_picks', labelKey: 'settingsNav.dynasty.picks', icon: Ticket },
        { key: 'dyn_trades', id: 'trade', labelKey: 'settingsNav.dynasty.trades', icon: ArrowLeftRight },
        { key: 'dyn_offseason', id: 'advanced', labelKey: 'settingsNav.dynasty.offseason', icon: RotateCcw },
      ],
    },
    {
      key: 'people',
      headingKey: 'settingsNav.group.people',
      items: (['team', 'members', 'coowners', 'security', 'commissioner'] as const).map(base),
    },
    ...formatEntries(o, false).map((g) => ({ key: g.key, headingKey: g.headingKey, items: asItems(g.entries) })),
  ]
  return groups
}

/** Which row is lit: the one last clicked while it still matches the open tab, else the first row for that tab. */
export function activeNavKey(items: SettingsNavItem[], activeTab: SettingsNavTabId, picked: string | null): string | null {
  const p = picked ? items.find((i) => i.key === picked) : undefined
  if (p && p.id === activeTab) return p.key
  return items.find((i) => i.id === activeTab)?.key ?? null
}

/** Scroll to an element the newly opened tab is about to render; gives up quietly after ~1s. */
function scrollToAnchor(anchor: string) {
  if (typeof window === 'undefined') return
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  let tries = 0
  const tick = () => {
    const el = document.getElementById(anchor)
    if (el) {
      el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
      return
    }
    if (tries++ < 60) window.requestAnimationFrame(tick)
  }
  window.requestAnimationFrame(tick)
}

/**
 * `savedLabel` lets a Shadow League replace the plain "Saved" with "Shadow rules updated", so a
 * commissioner is never told a change landed anywhere but AllFantasy. Defaults to "Saved".
 */
function statusLabel(s: AutosaveStatus, savedLabel?: string): string | null {
  if (s === 'saving') return 'Saving…'
  if (s === 'saved') return savedLabel ?? 'Saved'
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
  savedLabel,
  showSurvivorTabs,
  showZombieTabs,
  showIdpTabs,
  showDevyTabs,
  showC2cTabs,
  showNativeDevyTab,
  showNativeC2cTab,
  dynasty,
  className,
}: {
  activeTab: SettingsNavTabId
  onSelect: (id: SettingsNavTabId) => void
  saveStatus: AutosaveStatus
  /** Overrides the "Saved" hint — Shadow Leagues pass "Shadow rules updated". */
  savedLabel?: string
  showSurvivorTabs?: boolean
  showZombieTabs?: boolean
  showIdpTabs?: boolean
  showDevyTabs?: boolean
  showC2cTabs?: boolean
  /** A Devy league on AllFantasy: the editable Devy settings (`/api/leagues/[id]/devy/config`). */
  showNativeDevyTab?: boolean
  /** A C2C league on AllFantasy: the editable C2C settings (`/api/leagues/[id]/merged-devy-c2c/config`). */
  showNativeC2cTab?: boolean
  /** A dynasty-family league: League / Dynasty / People groups. Off, the flat list is unchanged. */
  dynasty?: boolean
  className?: string
}) {
  const { t } = useOptionalLanguage()
  const [picked, setPicked] = useState<string | null>(null)
  const hint = statusLabel(saveStatus, savedLabel)
  const groups = buildSettingsNavGroups({
    showSurvivorTabs,
    showZombieTabs,
    showIdpTabs,
    showDevyTabs,
    showC2cTabs,
    showNativeDevyTab,
    showNativeC2cTab,
    dynasty,
  })
  const activeKey = activeNavKey(groups.flatMap((g) => g.items), activeTab, picked)

  const select = (item: SettingsNavItem) => {
    setPicked(item.key)
    onSelect(item.id)
    if (item.anchor) scrollToAnchor(item.anchor)
  }
  const labelOf = (item: SettingsNavItem) => (item.labelKey ? t(item.labelKey) : item.label ?? item.id)

  if (!dynasty) {
    return (
      <nav
        className={clsx(
          'flex flex-shrink-0 flex-col gap-0.5 border-white/[0.08] bg-[#060a12] p-3 md:border-r',
          'max-h-[min(40vh,420px)] w-full overflow-x-auto overflow-y-auto md:max-h-none md:h-full md:w-[min(30%,280px)] md:min-w-[220px]',
          className,
        )}
        aria-label="League settings sections"
      >
        {groups[0]!.items.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => select(item)}
              className={clsx(
                'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] transition-colors',
                activeKey === item.key
                  ? 'bg-white/[0.08] font-medium text-teal-300/95'
                  : 'text-white/65 hover:bg-white/[0.05] hover:text-white/90',
              )}
            >
              <Icon className="h-4 w-4 flex-shrink-0" strokeWidth={1.8} aria-hidden="true" />
              <span className="min-w-0">{labelOf(item)}</span>
            </button>
          )
        })}
        {hint ? <p className="mt-3 border-t border-white/[0.06] px-2 pt-3 text-[11px] text-white/40">{hint}</p> : null}
      </nav>
    )
  }

  return (
    <nav
      className={clsx(
        'flex flex-shrink-0 flex-col gap-5 border-[color:var(--dyn-rail,#1C2333)] bg-[color:var(--dyn-ink,#0B0F17)] p-3 md:border-r md:px-4 md:py-6',
        'max-h-[min(40vh,420px)] w-full overflow-x-hidden overflow-y-auto md:max-h-none md:h-full md:w-[min(30%,300px)] md:min-w-[230px]',
        className,
      )}
      aria-label="League settings sections"
      data-testid="settings-nav-dynasty"
    >
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-0.5" role="group" aria-labelledby={`settings-nav-group-${group.key}`}>
          <span
            id={`settings-nav-group-${group.key}`}
            className={clsx(
              'px-3 pb-1.5 text-[12px] font-semibold uppercase tracking-[0.12em]',
              group.accent ? 'text-[color:var(--dyn-gold,#D4A24C)]' : 'text-[color:var(--dyn-faint,#9AA4B2)]',
            )}
          >
            {group.headingKey ? t(group.headingKey) : null}
          </span>
          {group.items.map((item) => {
            const Icon = item.icon
            const active = activeKey === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => select(item)}
                aria-current={active ? 'page' : undefined}
                data-nav-key={item.key}
                className={clsx(
                  'flex min-h-[44px] items-center gap-3 rounded-[10px] px-3 py-2 text-left text-[14px] transition-colors motion-reduce:transition-none',
                  active
                    ? 'bg-[color:var(--dyn-gold,#D4A24C)] font-semibold text-[color:var(--dyn-ink,#0B0F17)]'
                    : 'text-[color:var(--dyn-text2,#C3CAD5)] hover:bg-white/[0.05] hover:text-[color:var(--dyn-text,#E8ECF2)]',
                )}
              >
                <Icon className="h-[18px] w-[18px] flex-shrink-0" strokeWidth={1.8} aria-hidden="true" />
                <span className="min-w-0">{labelOf(item)}</span>
              </button>
            )
          })}
        </div>
      ))}
      {hint ? (
        <p className="border-t border-[color:var(--dyn-rail,#1C2333)] px-2 pt-3 text-[11px] text-[color:var(--dyn-faint,#9AA4B2)]">{hint}</p>
      ) : null}
    </nav>
  )
}
