import { Rocket, Workflow, BookOpen, LifeBuoy, Map, type LucideIcon } from 'lucide-react'
import type { CommissionerHelpCategory } from '@/lib/commissioner-ui/contracts'

export const HELP_CATEGORY_LABELS: Record<CommissionerHelpCategory, string> = {
  'getting-started': 'Getting Started',
  workflows: 'Workflows',
  glossary: 'Glossary',
  troubleshooting: 'Troubleshooting',
  'module-guide': 'Module Guides',
}

export const HELP_CATEGORY_ICONS: Record<CommissionerHelpCategory, LucideIcon> = {
  'getting-started': Rocket,
  workflows: Workflow,
  glossary: BookOpen,
  troubleshooting: LifeBuoy,
  'module-guide': Map,
}

/** Display order — orientation first, then the two everyday-use categories, reference material last. */
export const HELP_CATEGORY_ORDER: CommissionerHelpCategory[] = [
  'getting-started',
  'workflows',
  'module-guide',
  'troubleshooting',
  'glossary',
]
