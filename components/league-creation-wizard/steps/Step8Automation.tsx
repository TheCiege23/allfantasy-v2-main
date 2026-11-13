'use client'

import type { LeagueCreationWizardState, WizardAutomationSettings } from '@/lib/league-creation-wizard/types'

export type Step8AutomationProps = {
  state: LeagueCreationWizardState
  onAutomationChange: (patch: Partial<WizardAutomationSettings>) => void
  onBack: () => void
  onNext: () => void
}

