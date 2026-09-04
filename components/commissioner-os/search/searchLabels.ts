import { Lightbulb, Users, Briefcase, FileText, Zap, Settings, Compass, HelpCircle, type LucideIcon } from 'lucide-react'
import type { CommissionerSearchResultCategory } from '@/lib/commissioner-ui/contracts'

/** Same icon choices as CommissionerSidebar's per-module MODULE_ICONS, so a search result and its source module always match visually. `page` has no single owning module, so it gets its own (Compass). */
export const SEARCH_CATEGORY_ICONS: Record<CommissionerSearchResultCategory, LucideIcon> = {
  recommendation: Lightbulb,
  manager: Users,
  task: Briefcase,
  report: FileText,
  automation: Zap,
  setting: Settings,
  page: Compass,
  help: HelpCircle,
}

export const SEARCH_CATEGORY_LABELS: Record<CommissionerSearchResultCategory, string> = {
  recommendation: 'Recommendations',
  manager: 'Managers',
  task: 'Tasks',
  report: 'Reports',
  automation: 'Automations',
  setting: 'Settings',
  page: 'Pages',
  help: 'Help Articles',
}

/** Grouping/display order — pages last, since a query almost always means "find a thing," not "navigate somewhere I could already reach from the sidebar." Help articles sit just before pages — reference material, not a primary entity, but still more specific than "navigate somewhere." */
export const SEARCH_CATEGORY_ORDER: CommissionerSearchResultCategory[] = [
  'recommendation',
  'manager',
  'task',
  'report',
  'automation',
  'setting',
  'help',
  'page',
]
